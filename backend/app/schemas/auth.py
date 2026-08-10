from pydantic import BaseModel
from app.schemas.user import UserOut

class TokenData(BaseModel):
    username: str | None = None

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    token: str
    user: UserOut
