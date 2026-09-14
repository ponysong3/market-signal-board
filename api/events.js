import { collectEvents } from '../scripts/fetch-events.js';
import { createLiveEvents, createEventsHandler } from '../scripts/live-events.js';

export default createEventsHandler(createLiveEvents({ build: collectEvents }));
