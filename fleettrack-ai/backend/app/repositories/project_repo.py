import uuid
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.project import Project
from app.models.user import User
from app.schemas.project import ProjectCreate, ProjectUpdate


class ProjectRepository:
    @staticmethod
    async def get_by_id(db: AsyncSession, project_id: uuid.UUID) -> Optional[Project]:
        query = (
            select(Project)
            .where(Project.id == project_id)
            .options(
                selectinload(Project.manager),
                selectinload(Project.vehicles),
                selectinload(Project.geofences),
            )
        )
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def list_projects(
        db: AsyncSession,
        manager_id: Optional[uuid.UUID] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Project]:
        query = (
            select(Project)
            .options(
                selectinload(Project.manager),
                selectinload(Project.vehicles),
            )
        )
        if manager_id:
            query = query.where(Project.assigned_manager_id == manager_id)

        query = query.order_by(Project.created_at.desc()).offset(skip).limit(limit)
        result = await db.execute(query)
        return list(result.scalars().all())

    @staticmethod
    async def create_project(db: AsyncSession, project_in: ProjectCreate) -> Project:
        project = Project(
            name=project_in.name,
            description=project_in.description,
            address=project_in.address,
            latitude=project_in.latitude,
            longitude=project_in.longitude,
            status=project_in.status,
            start_date=project_in.start_date,
            end_date=project_in.end_date,
            assigned_manager_id=project_in.assigned_manager_id,
        )
        db.add(project)
        await db.flush()
        return await ProjectRepository.get_by_id(db, project.id)  # type: ignore

    @staticmethod
    async def update_project(db: AsyncSession, project: Project, project_in: ProjectUpdate) -> Project:
        update_data = project_in.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(project, field, value)

        await db.flush()
        return await ProjectRepository.get_by_id(db, project.id)  # type: ignore

    @staticmethod
    async def delete_project(db: AsyncSession, project: Project) -> None:
        await db.delete(project)
        await db.flush()
