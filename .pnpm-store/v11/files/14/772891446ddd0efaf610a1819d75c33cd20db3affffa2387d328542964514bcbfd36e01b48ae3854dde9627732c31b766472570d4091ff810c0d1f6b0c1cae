import EventEmitter from 'node:events';
import * as Attorney from "./attorney.js";
import Contractor from "./contractor.js";
import Manager from "./manager.js";
import Timekeeper from "./timekeeper.js";
import Boss from "./boss.js";
import Bam from "./bam.js";
import Navigator from "./navigator.js";
import Notifier from "./notifier.js";
import { delay } from "./tools.js";
import * as plans from "./plans.js";
import DbDefault from "./db.js";
export { JOB_STATES as states } from "./plans.js";
export { QUEUE_POLICIES as policies } from "./plans.js";
export const events = Object.freeze({
    error: 'error',
    warning: 'warning',
    wip: 'wip',
    stopped: 'stopped',
    bam: 'bam',
    flow: 'flow'
});
export function getConstructionPlans(schema) {
    return Contractor.constructionPlans(schema);
}
export function getMigrationPlans(schema, version, options) {
    return Contractor.migrationPlans(schema, version, options);
}
export function getRollbackPlans(schema, version) {
    return Contractor.rollbackPlans(schema, version);
}
export class PgBoss extends EventEmitter {
    #stoppingOn;
    #stopped;
    #started;
    #startingPromise = null;
    #stoppingPromise = null;
    #config;
    #db;
    #boss;
    #contractor;
    #manager;
    #timekeeper;
    #bam;
    #navigator;
    #notifier;
    constructor(value) {
        super();
        this.#stoppingOn = null;
        this.#stopped = true;
        const config = Attorney.getConfig(value);
        this.#config = config;
        const db = this.getDb();
        this.#db = db;
        if ('_pgbdb' in this.#db && this.#db._pgbdb) {
            this.#promoteEvents(this.#db);
        }
        const contractor = new Contractor(db, config);
        const manager = new Manager(db, config);
        const boss = new Boss(db, manager, config);
        const timekeeper = new Timekeeper(db, manager, config);
        manager.timekeeper = timekeeper;
        const bam = new Bam(db, config);
        const navigator = new Navigator(db, manager, config);
        const notifier = new Notifier(db, manager, config);
        manager.notifier = notifier;
        this.#promoteEvents(manager);
        this.#promoteEvents(boss);
        this.#promoteEvents(timekeeper);
        this.#promoteEvents(bam);
        this.#promoteEvents(navigator);
        this.#promoteEvents(notifier);
        this.#boss = boss;
        this.#contractor = contractor;
        this.#manager = manager;
        this.#timekeeper = timekeeper;
        this.#bam = bam;
        this.#navigator = navigator;
        this.#notifier = notifier;
    }
    #promoteEvents(emitter) {
        for (const event of Object.values(emitter?.events)) {
            emitter.on(event, arg => this.emit(event, arg));
        }
    }
    async start() {
        // A stop() already in flight must finish (clearing any resources it's tearing down) before a
        // fresh start() begins, otherwise the two race over the same intervals/pool.
        if (this.#stoppingPromise) {
            await this.#stoppingPromise.catch(() => { });
        }
        // Return the SAME in-flight promise to a concurrent caller instead of a fresh `this` — a
        // second caller must observe the actual outcome (including a rejection), not silently no-op
        // while the first call is still mid-flight.
        if (this.#startingPromise) {
            return this.#startingPromise;
        }
        if (this.#started) {
            return this;
        }
        // Cleared to false before any subsystem is started (not just on success): if #doStart throws
        // partway through, subsystems already started (e.g. manager's queueCacheInterval/wipInterval)
        // must still be reachable by stop() for cleanup, and stop() no-ops whenever #stopped is true.
        this.#stopped = false;
        this.#startingPromise = this.#doStart();
        try {
            return await this.#startingPromise;
        }
        finally {
            this.#startingPromise = null;
        }
    }
    async #doStart() {
        if (this.#db._pgbdb && !this.#db.opened) {
            await this.#db.open();
        }
        await this.#warnIfDistributedMisconfigured();
        if (this.#config.migrate) {
            await this.#contractor.start();
        }
        else {
            await this.#contractor.check();
        }
        await this.#manager.start();
        if (this.#config.useListenNotify) {
            await this.#notifier.start();
        }
        if (this.#config.supervise) {
            await this.#boss.start();
            await this.#navigator.start();
        }
        if (this.#config.schedule) {
            await this.#timekeeper.start();
        }
        if (this.#config.migrate) {
            await this.#bam.start();
        }
        this.#started = true;
        return this;
    }
    // YugabyteDB needs the yugabytedb backend profile (no table partitioning + no advisory locks;
    // partitioned queues are not supported there). pg-boss can't know the backend at construction
    // time, so detect it from the server version at startup and warn when the profile isn't selected.
    // Best-effort: never block startup on this check.
    async #warnIfDistributedMisconfigured() {
        try {
            const { rows } = await this.#db.executeSql('SELECT version()');
            const version = rows?.[0]?.version || '';
            if (/yugabyte|-yb-/i.test(version)) {
                if (!this.#config.noTablePartitioning || !this.#config.noAdvisoryLocks) {
                    this.emit(events.warning, {
                        message: "YugabyteDB detected: set backend: 'yugabytedb' for compatibility. Partitioned queues (partition: true) are not supported on YugabyteDB.",
                        data: { backend: 'yugabytedb' }
                    });
                }
            }
        }
        catch {
            // version detection is best-effort and must never prevent startup
        }
    }
    async stop(options = {}) {
        // A start() already in flight must finish (or fail) before stop() evaluates state, otherwise
        // stop() reads #stopped mid-start and silently no-ops while start() keeps running.
        if (this.#startingPromise) {
            await this.#startingPromise.catch(() => { });
        }
        if (this.#stoppingPromise) {
            return this.#stoppingPromise;
        }
        if (this.#stopped) {
            return;
        }
        let { close = true, graceful = true, timeout = 30000 } = options;
        timeout = Math.max(timeout, 1000);
        this.#stoppingOn = Date.now();
        this.#stoppingPromise = this.#doStop(close, graceful, timeout);
        try {
            return await this.#stoppingPromise;
        }
        finally {
            this.#stoppingPromise = null;
        }
    }
    async #doStop(close, graceful, timeout) {
        try {
            await this.#notifier.stop();
            await this.#manager.stop();
            await this.#timekeeper.stop();
            await this.#boss.stop();
            await this.#navigator.stop();
            await this.#bam.stop();
            const shutdown = async () => {
                await this.#manager.failWip();
                if (this.#db._pgbdb && this.#db.opened && close) {
                    await this.#db.close();
                    // Give event loop time to process socket closes
                    await delay(10);
                }
                this.#stopped = true;
                this.#started = false;
                this.emit(events.stopped);
            };
            if (!graceful) {
                await shutdown();
                return;
            }
            while ((Date.now() - this.#stoppingOn) < timeout && this.#manager.hasPendingCleanups()) {
                await delay(500);
            }
            await shutdown();
        }
        finally {
            // Reset unconditionally (success or throw) so a stop() that fails partway can be retried
            // instead of every future stop()/start() call silently no-op-ing forever on the stale marker.
            this.#stoppingOn = null;
        }
    }
    async send(...args) {
        return await this.#manager.send(...args);
    }
    async sendAfter(name, data, options, after) {
        return this.#manager.sendAfter(name, data, options, after);
    }
    sendThrottled(name, data, options, seconds, key) {
        return this.#manager.sendThrottled(name, data, options, seconds, key);
    }
    update(...args) {
        return this.#manager.update(...args);
    }
    upsert(...args) {
        return this.#manager.upsert(...args);
    }
    sendDebounced(name, data, options, seconds, key) {
        return this.#manager.sendDebounced(name, data, options, seconds, key);
    }
    insert(name, jobs, options) {
        return this.#manager.insert(name, jobs, options);
    }
    flow(jobs, options) {
        return this.#manager.flow(jobs, options);
    }
    fetch(name, options = {}) {
        return this.#manager.fetch(name, options);
    }
    work(...args) {
        return this.#manager.work(...args);
    }
    offWork(name, options) {
        return this.#manager.offWork(name, options);
    }
    notifyWorker(workerId) {
        return this.#manager.notifyWorker(workerId);
    }
    subscribe(event, name) {
        return this.#manager.subscribe(event, name);
    }
    unsubscribe(event, name) {
        return this.#manager.unsubscribe(event, name);
    }
    publish(event, data, options) {
        return this.#manager.publish(event, data, options);
    }
    cancel(name, id, options) {
        return this.#manager.cancel(name, id, options);
    }
    resume(name, id, options) {
        return this.#manager.resume(name, id, options);
    }
    retry(name, id, options) {
        return this.#manager.retry(name, id, options);
    }
    deleteJob(name, id, options) {
        return this.#manager.deleteJob(name, id, options);
    }
    redrive(name, options) {
        return this.#manager.redrive(name, options);
    }
    deleteQueuedJobs(name) {
        return this.#manager.deleteQueuedJobs(name);
    }
    deleteStoredJobs(name) {
        return this.#manager.deleteStoredJobs(name);
    }
    deleteAllJobs(name) {
        return this.#manager.deleteAllJobs(name);
    }
    complete(name, id, data, options) {
        return this.#manager.complete(name, id, data, options);
    }
    fail(name, id, data, options) {
        return this.#manager.fail(name, id, data, options);
    }
    touch(name, id, options) {
        return this.#manager.touch(name, id, options);
    }
    /**
     * @deprecated Use findJobs() instead
     */
    getJobById(name, id, options) {
        return this.#manager.getJobById(name, id, options);
    }
    findJobs(name, options) {
        return this.#manager.findJobs(name, options);
    }
    createQueue(name, options) {
        return this.#manager.createQueue(name, options);
    }
    getBlockedKeys(name) {
        return this.#manager.getBlockedKeys(name);
    }
    getDependencies(name, id, options) {
        return this.#manager.getDependencies(name, id, options);
    }
    getDependents(name, id, options) {
        return this.#manager.getDependents(name, id, options);
    }
    updateQueue(name, options) {
        return this.#manager.updateQueue(name, options);
    }
    deleteQueue(name) {
        return this.#manager.deleteQueue(name);
    }
    getQueues(names) {
        return this.#manager.getQueues(names);
    }
    getQueue(name) {
        return this.#manager.getQueue(name);
    }
    getQueueStats(name, options) {
        return this.#manager.getQueueStats(name, options);
    }
    isMaintaining() {
        return this.#boss.maintaining;
    }
    isBamWorking() {
        return this.#bam.working;
    }
    isResolvingFlow() {
        return this.#navigator.working;
    }
    isCheckingSkew() {
        return this.#timekeeper.checkingSkew;
    }
    supervise(name) {
        return this.#boss.supervise(name);
    }
    // Force an immediate flow-resolution pass (unblock dependents of completed jobs) instead of
    // waiting for the next background poll. Mirrors supervise() for on-demand maintenance.
    resolveFlow() {
        return this.#navigator.resolveNow();
    }
    getWipData(options) {
        return this.#manager.getWipData(options);
    }
    getSpy(name) {
        return this.#manager.getSpy(name);
    }
    clearSpies() {
        this.#manager.clearSpies();
    }
    isInstalled() {
        return this.#contractor.isInstalled();
    }
    schemaVersion() {
        return this.#contractor.schemaVersion();
    }
    detectSchemaDrift() {
        return this.#contractor.detectDrift();
    }
    schedule(name, cron, data, options) {
        return this.#timekeeper.schedule(name, cron, data, options);
    }
    unschedule(name, key) {
        return this.#timekeeper.unschedule(name, key);
    }
    getSchedules(name, key) {
        return this.#timekeeper.getSchedules(name, key);
    }
    async getBamStatus() {
        const sql = plans.getBamStatus(this.#config.schema);
        const { rows } = await this.#db.executeSql(sql);
        return rows;
    }
    async getBamEntries() {
        const sql = plans.getBamEntries(this.#config.schema);
        const { rows } = await this.#db.executeSql(sql);
        return rows;
    }
    getDb() {
        if (this.#db) {
            return this.#db;
        }
        if (this.#config.db) {
            return this.#config.db;
        }
        return new DbDefault(this.#config);
    }
}
export { fromKnex, fromKysely, fromDrizzle, fromPrisma, fromPglite, } from "./adapters/index.js";
