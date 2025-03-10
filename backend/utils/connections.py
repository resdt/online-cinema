import json
import os
import pickle
import re
from typing import AsyncGenerator

import aioboto3
import asyncpg
from aiobotocore.session import get_session
from fastapi import HTTPException


DB_LINK = os.getenv("DB_LINK")
PARAMETER_LIST = re.split(r"[:/\@\?]+", DB_LINK)
DB_PARAMS = {"user": PARAMETER_LIST[1],
             "password": PARAMETER_LIST[2],
             "host": PARAMETER_LIST[3],
             "database": PARAMETER_LIST[4],
             "port": "5432"}

S3_CONFIG = {"endpoint_url": "https://s3.timeweb.cloud",
             "region_name": "ru-1",
             "aws_access_key_id": os.getenv("S3_KEY"),
             "aws_secret_access_key": os.getenv("S3_SECRET_KEY")}
BUCKET_NAME = os.getenv("BUCKET_NAME")


async def execute_query(query, *parameters):
    connection = await asyncpg.connect(**DB_PARAMS)
    try:
        results = await connection.fetch(query, *parameters)
        return [dict(row) for row in results]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    finally:
        await connection.close()


async def load_movie_to_s3(key, body, content_type):
    session = get_session()
    async with session.create_client("s3", **S3_CONFIG) as s3:
        await s3.put_object(Bucket=BUCKET_NAME, Key=key, Body=body, ContentType=content_type)


async def get_movie_from_s3(movie_id: int) -> dict:
    session = get_session()
    async with session.create_client("s3", **S3_CONFIG) as s3:
        try:
            metadata_key = f"movies/{movie_id}/metadata.json"
            metadata_resp = await s3.get_object(Bucket=BUCKET_NAME, Key=metadata_key)
            metadata = json.loads(await metadata_resp["Body"].read())
        except Exception:
            return {"movie_id": movie_id,
                    "title": None,
                    "description": None,
                    "poster_url": None}
        try:
            image_key = f"movies/{movie_id}/images/poster.jpg"
            await s3.head_object(Bucket=BUCKET_NAME, Key=image_key)
            poster_url = f"{S3_CONFIG['endpoint_url']}/{BUCKET_NAME}/{image_key}"
        except s3.exceptions.ClientError:
            poster_url = None

    return {"movie_id": movie_id,
            "title": metadata.get("title"),
            "description": metadata.get("description"),
            "poster_url": poster_url}


async def load_model_from_s3(key):
    session = get_session()
    async with session.create_client("s3", **S3_CONFIG) as s3:
        response = await s3.get_object(Bucket=BUCKET_NAME, Key=key)
        async with response["Body"] as stream:
            data = await stream.read()

        model = pickle.loads(data)
        return model


async def get_file_size(file_key: str) -> int:
    session = aioboto3.Session()
    async with session.client("s3", **S3_CONFIG) as s3_client:
        head_resp = await s3_client.head_object(
            Bucket=BUCKET_NAME,
            Key=file_key,
        )
    return head_resp["ContentLength"]


async def s3_range_download(file_key: str, start: int, end: int) -> AsyncGenerator[bytes, None]:
    range_param = f"bytes={start}-{end}"
    session = aioboto3.Session()
    async with session.client("s3", **S3_CONFIG) as s3_client:
        s3_resp = await s3_client.get_object(
            Bucket=BUCKET_NAME,
            Key=file_key,
            Range=range_param,
        )

        # S3 Body is an async stream
        async for chunk in s3_resp["Body"].iter_chunks(chunk_size=1024 * 1024):
            yield chunk
