import asyncio
import re

import utils.connections as conn
from fastapi import APIRouter, HTTPException, Request, Response, status, File, Form, UploadFile
from fastapi.responses import StreamingResponse

from model import MovieRecommender


router = APIRouter()

model = None


@router.on_event("startup")
async def load_model():
    global model
    key = "recommendation_model.pkl"
    model = await MovieRecommender.load_from_s3(key)


async def fetch_movie(movie_id):
    return await conn.get_movie_from_s3(movie_id)


@router.get("/api/v1/movies")
async def get_movies(page: int = 1, size: int = 50):
    movie_ids_query = """
SELECT movie_id
  FROM link;
    """
    try:
        movie_data = await conn.execute_query(movie_ids_query)
        if not movie_data:
            raise HTTPException(status_code=404, detail="Movie not found")
        movie_ids = [cur_movie["movie_id"] for cur_movie in movie_data]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")

    try:
        cur_page = [movie_ids[i:i + size] for i in range(0, len(movie_ids), size)][page - 1]
        movies = await asyncio.gather(*[fetch_movie(movie_id) for movie_id in cur_page])
        result = [movie for movie in movies
                  if movie["title"] is not None
                  and movie["poster_url"] is not None]
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")


@router.get("/api/v1/movies/{movie_id}/show_page")
async def get_movie(movie_id: str):
    try:
        return await fetch_movie(movie_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")


@router.get("/api/v1/movies/{movie_id}/stream")
async def stream_movie(movie_id: str, request: Request):
    file_key = f"movies/{movie_id}/movie.mp4"

    # 1. Retrieve file size (HEAD request)
    try:
        file_size = await conn.get_file_size(file_key)
    except Exception:
        return Response(
            content=f"Movie '{movie_id}' not found in S3",
            status_code=status.HTTP_404_NOT_FOUND
        )

    # 2. Parse Range header (if present)
    range_header = request.headers.get("range")
    if range_header:
        is_mached = re.search(r"bytes=(\d+)-(\d*)", range_header)
        if is_mached:
            start = int(is_mached.group(1))
            end_str = is_mached.group(2)
            end = int(end_str) if end_str else file_size - 1
        else:
            start = 0
            end = file_size - 1
    else:
        start = 0
        end = file_size - 1

    content_length = end - start + 1

    # 3. Create an async generator for streaming from S3
    s3_stream = conn.s3_range_download(file_key, start, end)

    # 4. Build response headers + return the stream
    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(content_length),
        "Content-Type": "video/mp4",
    }

    return StreamingResponse(
        s3_stream,
        status_code=status.HTTP_206_PARTIAL_CONTENT,
        media_type="video/mp4",
        headers=headers,
    )


@router.post("/api/v1/movies/add")
async def add_movie(title: str = Form(...),
                    description: str = Form(...),
                    genres: str = Form(...),
                    poster: UploadFile = File(...)):
    movie_query = """
INSERT INTO movie (title, genres)
VALUES ($1, $2)
RETURNING movie_id;
    """
    try:
        movie_data = await conn.execute_query(movie_query, title, genres)
        movie_id = movie_data[0]["movie_id"]
        metadata = {"title": title,
                    "description": description}
        metadata_bytes = json.dumps(metadata).encode("utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")

    try:
        # Upload the poster image
        poster_path = f"movies/{movie_id}/images/poster.jpg"
        poster_content = await poster.read()
        await conn.load_movie_to_s3(poster_path, poster_content, poster.content_type)

        # Upload the metadata JSON
        metadata_path = f"movies/{movie_id}/metadata.json"
        await conn.load_movie_to_s3(metadata_path, metadata_bytes, "application/json")

        return {"message": "Movie data uploaded successfully."}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to upload movie data: {str(e)}")


@router.get("/api/v1/movies/you_may_like")
async def you_may_like(user_id: int, top_n: int = 10):
    movie_query = """
SELECT movie_id
  FROM movie;
    """
    try:
        movie_data = await conn.execute_query(movie_query)
        if not movie_data:
            raise HTTPException(status_code=404, detail="Movie not found")
        all_movies = [cur_movie["movie_id"] for cur_movie in movie_data]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")

    recommendations = model.recommend_movies(user_id=user_id, N=top_n)
    recommendations = [(int(movie_id), float(score)) for movie_id, score in recommendations]

    recommended_movie_ids = [cur_movie[0] for cur_movie in recommendations]
    movies = await asyncio.gather(*[fetch_movie(movie_id) for movie_id in recommended_movie_ids])
    result = [movie for movie in movies
              if movie["title"] is not None
              and movie["poster_url"] is not None]
    return result


@router.get("/api/v1/movies/top_rated")
async def top_rated():
    top_rated_query = """
SELECT movie_id
  FROM link
       JOIN rating USING(movie_id)
 ORDER BY rating DESC
 LIMIT 10 OFFSET $1;
    """
    offset = 0
    valid_movies = []
    try:
        while len(valid_movies) < 10:
            movie_data = await conn.execute_query(top_rated_query, offset)
            if not movie_data:
                break
            movie_ids = [cur_movie["movie_id"] for cur_movie in movie_data]
            movies = await asyncio.gather(*[fetch_movie(movie_id) for movie_id in movie_ids])
            valid_movies.extend([movie for movie in movies
                                 if movie["title"] is not None
                                 and movie["poster_url"] is not None])
            offset += 10
        return valid_movies[:10]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")


@router.get("/api/v1/movies/search")
async def search(movie: str):
    # Split search query into words and filter out empty strings
    search_words = [word.strip() for word in movie.split() if word.strip()]

    # Create WHERE condition for each word
    where_conditions = " AND ".join([f"LOWER(title) LIKE LOWER('%' || ${i+1} || '%')"
                                   for i in range(len(search_words))])

    movie_query = f"""
SELECT movie_id
  FROM movie
       RIGHT JOIN link USING(movie_id)
 WHERE {where_conditions}
 LIMIT 10 OFFSET ${len(search_words) + 1};
    """

    offset = 0
    valid_movies = []
    try:
        while len(valid_movies) < 10:
            # Pass all words as parameters + offset
            params = [*search_words, offset]
            movie_data = await conn.execute_query(movie_query, *params)
            if not movie_data:
                break
            movie_ids = [cur_movie["movie_id"] for cur_movie in movie_data]
            movies = await asyncio.gather(*[fetch_movie(movie_id) for movie_id in movie_ids])
            valid_movies.extend([movie for movie in movies
                                 if movie["title"] is not None
                                 and movie["poster_url"] is not None])
            offset += 10
        return valid_movies[:10]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")


@router.get("/api/v1/movies/may_be_interesting")
async def may_be_interesting(movie_id: int):
    offset = 0
    valid_movies = []
    genres_query = f"""
WITH movie_genres AS (
  SELECT unnest(string_to_array(genres, '|')) AS genre
    FROM movie
   WHERE movie_id = $1
),
similar_movies AS (
  SELECT m.movie_id,
         COUNT(*) AS matching_genres,
         COALESCE(r.rating, 0) as avg_rating
    FROM movie m
         LEFT JOIN rating r USING(movie_id)
         RIGHT JOIN link l USING(movie_id),
         unnest(string_to_array(m.genres, '|')) AS movie_genre
   WHERE m.movie_id != $1
         AND movie_genre IN (SELECT genre FROM movie_genres)
   GROUP BY m.movie_id, r.rating
)
SELECT movie_id
  FROM similar_movies
 ORDER BY matching_genres DESC, avg_rating DESC
 LIMIT 10 OFFSET $2;
    """
    try:
        while len(valid_movies) < 10:
            movie_data = await conn.execute_query(genres_query, movie_id, offset)
            if not movie_data:
                break
            movie_ids = [cur_movie["movie_id"] for cur_movie in movie_data]
            movies = await asyncio.gather(*[fetch_movie(movie_id) for movie_id in movie_ids])
            valid_movies.extend([movie for movie in movies
                                 if movie["title"] is not None
                                 and movie["poster_url"] is not None])
            offset += 10
        return valid_movies[:10]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")
