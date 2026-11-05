import uuid
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash
from app.models.user import User
from app.schemas.user import UserCreate, UserUpdate


class UserRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, user_id: uuid.UUID) -> Optional[User]:
        query = select(User).where(User.id == user_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> Optional[User]:
        query = select(User).where(User.email == email.lower().strip())
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_all(self, skip: int = 0, limit: int = 100) -> List[User]:
        query = select(User).offset(skip).limit(limit).order_by(User.created_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def create(self, user_in: UserCreate, hashed_password: Optional[str] = None) -> User:
        pw_hash = hashed_password or get_password_hash(user_in.password)
        user = User(
            name=user_in.name,
            email=user_in.email.lower().strip(),
            password_hash=pw_hash,
            role=user_in.role,
            is_active=user_in.is_active,
        )
        self.db.add(user)
        await self.db.flush()
        await self.db.refresh(user)
        return user

    async def update(self, user: User, update_data: dict) -> User:
        for field, value in update_data.items():
            setattr(user, field, value)
        await self.db.flush()
        await self.db.refresh(user)
        return user

    async def delete(self, user: User) -> None:
        await self.db.delete(user)
        await self.db.flush()

    # Static helpers for backward compatibility
    @staticmethod
    async def fetch_by_id(db: AsyncSession, user_id: uuid.UUID) -> Optional[User]:
        return await UserRepository(db).get_by_id(user_id)

    @staticmethod
    async def fetch_by_email(db: AsyncSession, email: str) -> Optional[User]:
        return await UserRepository(db).get_by_email(email)

    @staticmethod
    async def list_users(db: AsyncSession, skip: int = 0, limit: int = 100) -> List[User]:
        return await UserRepository(db).get_all(skip, limit)

    @staticmethod
    async def create_user(db: AsyncSession, user_in: UserCreate) -> User:
        return await UserRepository(db).create(user_in)

    @staticmethod
    async def update_user(db: AsyncSession, user: User, user_in: UserUpdate) -> User:
        data = user_in.model_dump(exclude_unset=True)
        if "password" in data and data["password"]:
            data["password_hash"] = get_password_hash(data.pop("password"))
        if "email" in data and data["email"]:
            data["email"] = data["email"].lower().strip()
        return await UserRepository(db).update(user, data)

    @staticmethod
    async def delete_user(db: AsyncSession, user: User) -> None:
        await UserRepository(db).delete(user)
