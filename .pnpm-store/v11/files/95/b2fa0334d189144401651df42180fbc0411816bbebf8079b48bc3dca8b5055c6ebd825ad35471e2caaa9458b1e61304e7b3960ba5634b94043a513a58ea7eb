export class JobSpy {
    #jobResults = new Map();
    #pendingPromises = [];
    clear() {
        this.#jobResults.clear();
        this.#pendingPromises = [];
    }
    waitForJobWithId(id, awaitedState) {
        return this.waitForJob(() => true, awaitedState, id);
    }
    waitForJob(dataSelector, awaitedState, specificId) {
        const selector = (job) => {
            if (specificId && job.id !== specificId) {
                return false;
            }
            return dataSelector(job.data);
        };
        // Check if we already have a matching job
        for (const job of this.#jobResults.values()) {
            if (job.state === awaitedState && selector(job)) {
                return Promise.resolve(this.#cloneJob(job));
            }
        }
        // Register promise to be resolved when job arrives
        return this.#registerPromise(selector, awaitedState);
    }
    #registerPromise(selector, awaitedState) {
        let resolve;
        const promise = new Promise((_resolve) => {
            resolve = _resolve;
        });
        this.#pendingPromises.push({ selector, awaitedState, resolve });
        return promise;
    }
    #getJobResultKey(id, state) {
        return `${id}:${state}`;
    }
    #cloneJob(job) {
        return {
            id: job.id,
            name: job.name,
            data: structuredClone(job.data),
            state: job.state,
            output: job.output ? structuredClone(job.output) : undefined
        };
    }
    addJob(id, name, data, state, output) {
        const job = {
            id,
            name,
            data: structuredClone(data),
            state,
            output: output ? structuredClone(output) : undefined
        };
        const key = this.#getJobResultKey(id, state);
        this.#jobResults.set(key, job);
        // Resolve any pending promises that match this job
        const matchingPromises = [];
        const remainingPromises = [];
        for (const pending of this.#pendingPromises) {
            if (pending.awaitedState === state && pending.selector(job)) {
                matchingPromises.push(pending);
            }
            else {
                remainingPromises.push(pending);
            }
        }
        this.#pendingPromises = remainingPromises;
        for (const pending of matchingPromises) {
            pending.resolve(this.#cloneJob(job));
        }
    }
}
