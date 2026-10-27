import type { Router } from '../http/router';
import { json, notFound, requireUser } from '../http/core';

export function taskRoutes(r: Router) {
  r.get('/api/tasks/:id', (ctx) => {
    const user = requireUser(ctx);
    const task = ctx.app.tasks.get(user.id, ctx.params.id);
    if (!task) throw notFound();
    return json(task);
  });

  r.post('/api/tasks/:id/cancel', (ctx) => {
    const user = requireUser(ctx);
    if (!ctx.app.tasks.cancel(user.id, ctx.params.id)) throw notFound('That task is not running.');
    return json({ ok: true });
  });
}
