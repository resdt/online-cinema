from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import routers.movies as movies
import routers.users as users


app = FastAPI()
app.add_middleware(CORSMiddleware,
                   allow_origins=["http://localhost:3000"],
                   allow_credentials=True,
                   allow_methods=["*"],
                   allow_headers=["*"])
app.include_router(movies.router)
app.include_router(users.router)


@app.get("/")
async def root():
    return {"message": "The server is running. Welcome!"}
