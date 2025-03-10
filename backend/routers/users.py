from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
import utils.connections as conn
import os
import hashlib

router = APIRouter()
pwd_context = CryptContext(
    schemes=["sha256_crypt"],
    deprecated="auto"
)

# Get settings from environment variables
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-for-development")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

class LoginUser(BaseModel):
    username: str
    password: str

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        hashed_attempt = hashlib.sha256(plain_password.encode()).hexdigest()
        return hashed_attempt == hashed_password
    except Exception as e:
        print(f"Password verification error: {e}")
        return False

@router.post("/api/v1/users/login")
async def login(data: LoginUser):
    cur_user_query = """
    SELECT username,
           hashed_password,
           user_type
      FROM users
     WHERE username = $1;
    """
    try:
        user_data = await conn.execute_query(cur_user_query, data.username)
        if not user_data:
            raise HTTPException(status_code=401, detail="Invalid username or password")

        user = user_data[0]
        
        if not verify_password(data.password, user["hashed_password"]):
            raise HTTPException(status_code=401, detail="Invalid username or password")

        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": user["username"], "user_type": user["user_type"]},
            expires_delta=access_token_expires
        )

        return {
            "message": "Login successful",
            "user_type": user["user_type"],
            "access_token": access_token,
            "token_type": "bearer"
        }
    except Exception as e:
        print(f"Login error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")

def create_access_token(data: dict, expires_delta: timedelta):
    to_encode = data.copy()
    expire = datetime.utcnow() + expires_delta
    to_encode.update({"exp": expire})
    try:
        encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
        return encoded_jwt
    except Exception as e:
        print(f"Token creation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error creating token: {str(e)}")
