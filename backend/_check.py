from app.core.database import SessionLocal
from app.models.user import User
from app.core.security import verify_password

db = SessionLocal()
u = db.query(User).filter(User.username == "admin").first()
print("hash:", u.password_hash)
for p in ["admin123", "yfzjlxy0527"]:
    print(p, "->", verify_password(p, u.password_hash))
