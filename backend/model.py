import logging
import os
import pickle
import re
from typing import Dict, List, Tuple

import implicit
import numpy as np
import pandas as pd
from aiobotocore.session import get_session
from implicit.evaluation import (mean_average_precision_at_k,
                                 ndcg_at_k,
                                 precision_at_k)
from scipy.sparse import csr_matrix
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import MinMaxScaler


S3_CONFIG = {"endpoint_url": "https://s3.timeweb.cloud",
             "region_name": "ru-1",
             "aws_access_key_id": os.getenv("S3_KEY"),
             "aws_secret_access_key": os.getenv("S3_SECRET_KEY")}
BUCKET_NAME = os.getenv("BUCKET_NAME")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class MovieRecommender:
    """
    Система рекомендации фильмов на основе коллаборативной фильтрации.

    Использует алгоритм ALS (Alternating Least Squares) для построения рекомендаций
    на основе неявных обратных связей пользователей.

    Параметры:
        factors (int): Количество скрытых факторов в модели (размерность векторного представления)
        regularization (float): Коэффициент регуляризации для предотвращения переобучения
        alpha (float): Коэффициент масштабирования уверенности в оценках
        iterations (int): Количество итераций обучения
        use_gpu (bool): Использовать ли GPU для ускорения вычислений
        content_weight (float): Вес контентной составляющей
    """

    def __init__(self,
                 factors: int = 100,
                 regularization: float = 0.01,
                 alpha: float = 40,
                 iterations: int = 20,
                 use_gpu: bool = False,
                 content_weight: float = 0.25):  # Вес контентной составляющей
        # Инициализация модели ALS
        self.model = implicit.als.AlternatingLeastSquares(
            factors=factors,
            regularization=regularization,
            iterations=iterations,
            alpha=alpha,
            use_gpu=use_gpu,
            calculate_training_loss=True
        )
        self.content_weight = content_weight
        self.user_id_map = {}
        self.movie_id_map = {}
        self.reverse_movie_id_map = {}
        self.sparse_matrix_train = None
        self.sparse_matrix_test = None
        self.movie_features = None
        self.genre_similarity = None
        self.movies_df = None
        self.movies_enriched = None

    def _create_mappings(self, ratings: pd.DataFrame) -> None:
        """
        Создает отображения между оригинальными ID и внутренними индексами.

        Args:
            ratings (pd.DataFrame): DataFrame с рейтингами
        """
        user_ids = ratings["userId"].unique()
        movie_ids = ratings["movieId"].unique()

        self.user_id_map = {user_id: idx for idx, user_id in enumerate(user_ids)}
        self.movie_id_map = {movie_id: idx for idx, movie_id in enumerate(movie_ids)}
        self.reverse_movie_id_map = {idx: movie_id for movie_id, idx in self.movie_id_map.items()}

    def _process_movie_features(self, data_dir: str) -> None:
        """Расширенная обработка характеристик фильмов с учетом тегов."""
        logger.info("Загрузка и обработка данных о фильмах и тегах...")

        # Загрузка базовых данных
        movies = pd.read_csv(os.path.join(data_dir, "movie.csv"))
        self.movies_df = movies

        # Извлечение года из названия
        self.movies_df["year"] = self.movies_df["title"].str.extract(r"\((\d{4})\)").astype(float)

        # Нормализация года
        scaler = MinMaxScaler()
        self.movies_df["year_normalized"] = scaler.fit_transform(
            self.movies_df[["year"]].fillna(self.movies_df["year"].mean())
        )

        # Обработка жанров
        genres = self.movies_df["genres"].str.get_dummies("|")

        # Оптимизированная обработка тегов
        logger.info("Обработка тегов...")
        genome_scores = pd.read_csv(os.path.join(data_dir, "genome_scores.csv"))
        genome_tags = pd.read_csv(os.path.join(data_dir, "genome_tags.csv"))

        # Выбираем только наиболее релевантные теги для каждого фильма
        top_tags = (genome_scores
                   .sort_values("relevance", ascending=False)
                   .groupby("movieId")
                   .head(5)
                   .merge(genome_tags, on="tagId"))

        # Создаем матрицу тегов более эффективно
        tag_matrix = pd.crosstab(
            top_tags["movieId"],
            top_tags["tag"],
            values=top_tags["relevance"],
            aggfunc="first"
        ).fillna(0)

        # Нормализация тегов
        tag_matrix = tag_matrix.div(tag_matrix.max(axis=1), axis=0).fillna(0)

        # Объединяем все признаки
        self.movie_features = pd.concat([
            genres,
            self.movies_df[["year_normalized"]]
        ], axis=1)

        # Добавляем теги только для фильмов, у которых они есть
        if not tag_matrix.empty:
            self.movie_features = pd.concat([
                self.movie_features,
                tag_matrix.reindex(self.movie_features.index).fillna(0)
            ], axis=1)

        # Заполняем пропуски
        self.movie_features = self.movie_features.fillna(0)

        # Сохраняем агрегированные теги для объяснений
        movie_tags_agg = (top_tags
                         .groupby("movieId")["tag"]
                         .agg(lambda x: " ".join(x))
                         .reset_index(name="aggregated_tags"))

        self.movies_enriched = pd.merge(
            self.movies_df,
            movie_tags_agg,
            on="movieId",
            how="left"
        )

        # Расчет матрицы схожести
        logger.info("Расчет матрицы схожести...")
        # Используем меньшую точность для экономии памяти
        features_array = self.movie_features.values.astype(np.float32)
        self.genre_similarity = cosine_similarity(features_array)

    def preprocess_data(self, data_dir: str, threshold: float = 4.0) -> None:
        """Расширенная предобработка данных."""
        logger.info("Начало предобработки данных...")

        # Обработка характеристик фильмов и тегов
        self._process_movie_features(data_dir)

        # Загрузка и фильтрация рейтингов
        logger.info("Обработка рейтингов...")
        ratings = pd.read_csv(os.path.join(data_dir, "rating.csv"))
        ratings = ratings[ratings["movieId"].isin(self.movies_df["movieId"])]

        # Бинаризация и масштабирование
        ratings["binary_rating"] = (ratings["rating"] >= threshold).astype(np.float32)  # Используем float32
        ratings["confidence"] = (1 + self.model.alpha * ratings["rating"] / 5.0).astype(np.float32)

        # Создание маппингов
        self._create_mappings(ratings)

        # Преобразование индексов
        ratings["user_index"] = ratings["userId"].map(self.user_id_map)
        ratings["item_index"] = ratings["movieId"].map(self.movie_id_map)

        # Разделение данных
        train_data, test_data = train_test_split(
            ratings,
            test_size=0.2,
            random_state=42,
            stratify=ratings["userId"]
        )

        # Создание разреженных матриц с использованием float32
        num_users = len(self.user_id_map)
        num_items = len(self.movie_id_map)

        self.sparse_matrix_train = csr_matrix(
            (train_data["confidence"].astype(np.float32),
             (train_data["user_index"], train_data["item_index"])),
            shape=(num_users, num_items)
        )

        self.sparse_matrix_test = csr_matrix(
            (test_data["binary_rating"].astype(np.float32),
             (test_data["user_index"], test_data["item_index"])),
            shape=(num_users, num_items)
        )

        logger.info(f"Предобработка завершена. Размеры матриц: {self.sparse_matrix_train.shape}")

    def _get_similar_movies_by_content(self, movie_idx: int, N: int = 10) -> List[Tuple[int, float]]:
        """Получение похожих фильмов на основе контентных характеристик."""
        similarities = self.genre_similarity[movie_idx]
        similar_indices = np.argsort(similarities)[::-1][1:N+1]
        return [(idx, similarities[idx]) for idx in similar_indices]

    def recommend_movies(self, user_id: int, N: int = 10) -> List[Tuple[int, float]]:
        """
        Получение гибридных рекомендаций фильмов для пользователя.

        Args:
            user_id (int): ID пользователя
            N (int): Количество рекомендаций

        Returns:
            List[Tuple[int, float]]: Список кортежей (id фильма, оценка релевантности)
        """
        if user_id not in self.user_id_map:
            raise ValueError(f"Пользователь с ID {user_id} не найден в данных")

        user_index = self.user_id_map[user_id]
        user_items = self.sparse_matrix_train[user_index].tocsr()

        # Получаем рекомендации на основе коллаборативной фильтрации
        cf_recommendations = self.model.recommend(
            user_index,
            user_items,
            N=N * 2,  # Запрашиваем больше рекомендаций для последующей гибридизации
            filter_already_liked_items=True
        )

        # Получаем любимые фильмы пользователя
        user_ratings = user_items.toarray()[0]
        favorite_movies = np.argsort(user_ratings)[::-1][:3]  # Топ-3 фильма

        # Получаем рекомендации на основе контента
        content_scores = np.zeros(len(self.movie_id_map))
        for movie_idx in favorite_movies:
            if user_ratings[movie_idx] > 0:  # Если фильм был оценен
                similar_movies = self._get_similar_movies_by_content(movie_idx, N * 2)
                for similar_idx, score in similar_movies:
                    if similar_idx < len(content_scores):  # Проверка индекса
                        content_scores[similar_idx] += score * user_ratings[movie_idx]

        # Нормализация скоров
        if content_scores.max() > 0:
            content_scores = content_scores / content_scores.max()

        # Комбинирование рекомендаций
        cf_scores = np.zeros(len(self.movie_id_map))

        # Фильтрация индексов, которые находятся в пределах размера массива
        valid_indices = cf_recommendations[0] < len(cf_scores)
        filtered_indices = cf_recommendations[0][valid_indices]
        filtered_scores = cf_recommendations[1][valid_indices]

        cf_scores[filtered_indices] = filtered_scores

        # Гибридные скоры
        hybrid_scores = (1 - self.content_weight) * cf_scores + self.content_weight * content_scores

        # Фильтрация уже просмотренных
        watched_mask = user_items.toarray()[0] > 0
        hybrid_scores[watched_mask] = -1

        # Получение топ-N рекомендаций
        top_indices = np.argsort(hybrid_scores)[::-1][:N]
        recommendations = [(self.reverse_movie_id_map[idx], hybrid_scores[idx])
                          for idx in top_indices if hybrid_scores[idx] > 0]

        return recommendations

    def get_movie_info(self, movie_id: int) -> Dict:
        """Получение информации о фильме."""
        movie = self.movies_df[self.movies_df["movieId"] == movie_id].iloc[0]

        # Извлечение года из названия с помощью регулярного выражения
        year_match = re.search(r"\((\d{4})\)", movie["title"])
        year = int(year_match.group(1)) if year_match else None

        return {
            "title": movie["title"],
            "genres": movie["genres"].split("|"),
            "year": year
        }

    def explain_recommendation(self, user_id: int, movie_id: int) -> str:
        """Объяснение рекомендации фильма."""
        if user_id not in self.user_id_map:
            raise ValueError(f"Пользователь с ID {user_id} не найден в данных")

        user_index = self.user_id_map[user_id]
        movie_index = self.movie_id_map.get(movie_id)

        if movie_index is None:
            raise ValueError(f"Фильм с ID {movie_id} не найден в данных")

        # Получаем любимые фильмы пользователя
        user_items = self.sparse_matrix_train[user_index].toarray()[0]
        favorite_indices = np.argsort(user_items)[::-1][:3]

        # Находим похожие фильмы среди любимых
        similar_movies = []
        for fav_idx in favorite_indices:
            if user_items[fav_idx] > 0:
                similarity = self.genre_similarity[movie_index][fav_idx]
                if similarity > 0.3:  # Порог схожести
                    fav_movie_id = self.reverse_movie_id_map[fav_idx]
                    similar_movies.append((fav_movie_id, similarity))

        if not similar_movies:
            return "Этот фильм рекомендован на основе общих предпочтений похожих пользователей."

        # Формируем объяснение
        movie_info = self.get_movie_info(movie_id)
        similar_movie_id, _ = max(similar_movies, key=lambda x: x[1])
        similar_movie_info = self.get_movie_info(similar_movie_id)

        return f"Фильм '{movie_info['title']}' рекомендован, потому что он похож на понравившийся вам '{similar_movie_info['title']}'. " \
               f"У них похожие жанры: {', '.join(set(movie_info['genres']) & set(similar_movie_info['genres']))}"

    def train(self) -> None:
        """Обучение модели."""
        if self.sparse_matrix_train is None:
            raise ValueError("Данные не предобработаны. Сначала вызовите preprocess_data")

        logger.info("Обучение модели...")
        self.model.fit(self.sparse_matrix_train.T)

    def evaluate(self, K: int = 10) -> Dict[str, float]:
        """Оценка качества модели."""
        logger.info(f"Оценка модели с K={K}...")

        precision = precision_at_k(
            self.model,
            self.sparse_matrix_train.T,
            self.sparse_matrix_test.T,
            K=K
        )

        map_score = mean_average_precision_at_k(
            self.model,
            self.sparse_matrix_train.T,
            self.sparse_matrix_test.T,
            K=K
        )

        ndcg = ndcg_at_k(
            self.model,
            self.sparse_matrix_train.T,
            self.sparse_matrix_test.T,
            K=K
        )

        return {
            f"precision@{K}": precision,
            f"map@{K}": map_score,
            f"ndcg@{K}": ndcg
        }

    def save_model(self, path: str) -> None:
        """Сохранение модели и всех необходимых данных."""
        with open(path, "wb") as f:
            pickle.dump({
                "model": self.model.__dict__,  # Сохраняем состояние модели
                "user_id_map": self.user_id_map,
                "movie_id_map": self.movie_id_map,
                "reverse_movie_id_map": self.reverse_movie_id_map,
                "movie_features": self.movie_features,
                "genre_similarity": self.genre_similarity,
                "movies_df": self.movies_df,
                "sparse_matrix_train": self.sparse_matrix_train,  # Сохраняем обучающую матрицу
                "sparse_matrix_test": self.sparse_matrix_test,    # Сохраняем тестовую матрицу
                "content_weight": self.content_weight
            }, f)

    @classmethod
    def load_model(cls, path: str) -> "MovieRecommender":
        """Загрузка модели и всех необходимых данных."""
        with open(path, "rb") as f:
            data = pickle.load(f)

        # Инициализируем объект MovieRecommender
        recommender = cls(content_weight=data["content_weight"])

        # Восстанавливаем состояние модели
        recommender.model.__dict__ = data["model"]

        # Восстанавливаем остальные компоненты
        recommender.user_id_map = data["user_id_map"]
        recommender.movie_id_map = data["movie_id_map"]
        recommender.reverse_movie_id_map = data["reverse_movie_id_map"]
        recommender.movie_features = data["movie_features"]
        recommender.genre_similarity = data["genre_similarity"]
        recommender.movies_df = data["movies_df"]
        recommender.sparse_matrix_train = data["sparse_matrix_train"]
        recommender.sparse_matrix_test = data["sparse_matrix_test"]

        return recommender

    @classmethod
    async def load_from_s3(cls, key: str) -> "MovieRecommender":
        """
        Асинхронная загрузка модели из S3 и создание экземпляра класса.
        """
        session = get_session()
        async with session.create_client("s3", **S3_CONFIG) as s3:
            response = await s3.get_object(Bucket=BUCKET_NAME, Key=key)
            async with response["Body"] as stream:
                data = await stream.read()

        # Десериализация модели
        saved_data = pickle.loads(data)

        # Создаем экземпляр класса и заполняем его данными
        recommender = cls(content_weight=saved_data["content_weight"])
        recommender.model.__dict__ = saved_data["model"]
        recommender.user_id_map = saved_data["user_id_map"]
        recommender.movie_id_map = saved_data["movie_id_map"]
        recommender.reverse_movie_id_map = saved_data["reverse_movie_id_map"]
        recommender.movie_features = saved_data["movie_features"]
        recommender.genre_similarity = saved_data["genre_similarity"]
        recommender.movies_df = saved_data["movies_df"]
        recommender.sparse_matrix_train = saved_data["sparse_matrix_train"]
        recommender.sparse_matrix_test = saved_data["sparse_matrix_test"]

        return recommender


if __name__ == "__main__":
    # Оптимированные параметры
    recommender = MovieRecommender(
        factors=100,
        regularization=0.01,
        alpha=40,
        iterations=20
    )

    # Подготовка данных и обучение
    data_dir = "dev/tables"
    recommender.preprocess_data(data_dir, threshold=3.5)
    recommender.train()

    print(recommender.evaluate())

    recommender.save_model("recommendation_model.pkl")
