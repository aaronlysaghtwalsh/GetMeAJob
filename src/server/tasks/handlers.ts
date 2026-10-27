import type { App } from '../app';
import { registerBrainTasks } from './brain-tasks';
import { registerApplicationTasks } from './application-tasks';

export function registerTaskHandlers(app: App): void {
  registerBrainTasks(app);
  registerApplicationTasks(app);
}
