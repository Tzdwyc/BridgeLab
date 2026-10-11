import { PlayAdvisorClient } from '../ai/play-advisor-client';

/** One local Worker is shared by robot turns and user hints. */
export const playAdvisor = new PlayAdvisorClient();
