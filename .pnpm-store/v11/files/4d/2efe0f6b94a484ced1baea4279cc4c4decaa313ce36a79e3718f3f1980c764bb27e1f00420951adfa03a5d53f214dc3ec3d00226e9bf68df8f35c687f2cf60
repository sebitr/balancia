import { delay } from "./tools.js";
const WORKER_STATES = {
    created: 'created',
    active: 'active',
    stopping: 'stopping',
    stopped: 'stopped'
};
class Worker {
    id;
    workId;
    name;
    options;
    fetch;
    onFetch;
    onError;
    resolveInterval;
    jobs = [];
    createdOn = Date.now();
    state = WORKER_STATES.created;
    lastFetchedOn = null;
    lastJobStartedOn = null;
    lastJobEndedOn = null;
    lastJobDuration = null;
    lastError = null;
    lastErrorOn = null;
    stopping = false;
    stopped = false;
    abortController = null;
    loopDelayPromise = null;
    beenNotified = false;
    runPromise = null;
    constructor({ id, workId, name, options, resolveInterval, fetch, onFetch, onError }) {
        this.id = id;
        this.workId = workId;
        this.name = name;
        this.options = options;
        this.fetch = fetch;
        this.onFetch = onFetch;
        this.onError = onError;
        this.resolveInterval = resolveInterval;
    }
    start() {
        this.runPromise = this.run();
    }
    async run() {
        this.state = WORKER_STATES.active;
        while (!this.stopping) {
            const started = Date.now();
            // Number of jobs the last fetch returned; stays 0 on error so a failed fetch backs
            // off to normal polling instead of hot-looping in burst mode.
            let fetchedCount = 0;
            try {
                this.beenNotified = false;
                const jobs = await this.fetch();
                this.lastFetchedOn = Date.now();
                if (jobs) {
                    fetchedCount = jobs.length;
                    this.jobs = jobs;
                    this.lastJobStartedOn = this.lastFetchedOn;
                    await this.onFetch(jobs);
                    this.lastJobEndedOn = Date.now();
                    this.jobs = [];
                }
            }
            catch (err) {
                this.lastErrorOn = Date.now();
                this.lastError = err;
                err.message = `${err.message} (Queue: ${this.name}, Worker: ${this.id})`;
                this.onError(err);
            }
            const duration = Date.now() - started;
            this.lastJobDuration = duration;
            // Resolve the effective delay each iteration: burst (continuous), NOTIFY backstop, or
            // the base poll (see Manager.work). fetchedCount lets the resolver keep going only while
            // fetches come back full — a short fetch resumes normal polling. A returned interval
            // <= duration + 100 (0 in burst mode) skips the delay and re-fetches immediately.
            const interval = this.resolveInterval(fetchedCount);
            if (!this.stopping && !this.beenNotified && (interval - duration) > 100) {
                this.loopDelayPromise = delay(interval - duration);
                await this.loopDelayPromise;
                this.loopDelayPromise = null;
            }
        }
        this.stopping = false;
        this.stopped = true;
        this.state = WORKER_STATES.stopped;
    }
    notify() {
        this.beenNotified = true;
        if (this.loopDelayPromise) {
            this.loopDelayPromise.abort();
        }
    }
    async stop() {
        this.stopping = true;
        this.state = WORKER_STATES.stopping;
        if (this.loopDelayPromise) {
            this.loopDelayPromise.abort();
        }
        await this.runPromise;
    }
    abort() {
        if (this.abortController && !this.abortController.signal.aborted) {
            this.abortController.abort();
        }
    }
    toWipData() {
        return {
            id: this.id,
            workId: this.workId,
            name: this.name,
            options: this.options,
            state: this.state,
            count: this.jobs.length,
            createdOn: this.createdOn,
            lastFetchedOn: this.lastFetchedOn,
            lastJobStartedOn: this.lastJobStartedOn,
            lastJobEndedOn: this.lastJobEndedOn,
            lastError: this.lastError,
            lastErrorOn: this.lastErrorOn,
            lastJobDuration: this.lastJobDuration
        };
    }
}
export default Worker;
