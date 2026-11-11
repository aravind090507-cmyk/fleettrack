web: sh -c 'cd backend && (alembic upgrade head || true) && cd .. && uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips="*"'
