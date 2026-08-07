# LearnFlow Backend

## Structure

- `server.js` starts the HTTP server, registers route modules, and installs the final error handler.
- `appContext.js` configures Express and exposes shared dependencies used by existing routes.
- `config/` contains application constants and default exam definitions.
- `routes/` contains endpoint registration grouped by domain.
- `services/` contains database-backed domain and infrastructure services.
- `utils/` contains small reusable helpers without HTTP concerns.
- `db.js` owns the MySQL connection pool.

## Route Modules

- `chatRoutes.js`: AI chat
- `systemRoutes.js`: health checks
- `userRoutes.js`: authentication, users, and profiles
- `examRoutes.js`: exams and certificates
- `lessonRoutes.js`: lessons and curriculum filtering
- `videoRoutes.js`: videos, enrollment, and progress
- `projectRoutes.js`: project management
- `catalogRoutes.js`: years, semesters, categories, and dashboard statistics

## Adding an Endpoint

1. Add the handler to the matching file in `routes/`.
2. Put reusable database logic in `services/`.
3. Put pure formatting or normalization logic in `utils/`.
4. Add shared constants to `config/constants.js`.
5. Keep `server.js` limited to application startup and middleware ordering.

## Commands

```bash
npm start
npm run dev
```

## Render deployment

This repository includes `render.yaml`, which creates both the Node web service
and a Render Postgres database. Create a new Render Blueprint from this GitHub
repository, provide one AI API key when prompted, and then import the PostgreSQL
schema/data into the created database. The service health check is `/api/health`.
