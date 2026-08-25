import { CronExpressionParser } from 'cron-parser';
import EventEmitter from 'node:events';
import * as Attorney from "./attorney.js";
import * as plans from "./plans.js";
import { delay } from "./tools.js";
import * as types from "./types.js";
import { emitAndPersistWarning } from "./warning.js";
export const QUEUES = {
    SEND_IT: '__pgboss__send-it'
};
const EVENTS = {
    error: 'error',
    schedule: 'schedule',
    warning: 'warning'
};
const WARNINGS = {
    CLOCK_SKEW: {
        message: 'Warning: Clock skew between this instance and the database server. This will not break scheduling, but is emitted any time the skew exceeds 60 seconds.'
    }
};
const WARNING_TYPES = {
    CLOCK_SKEW: 'clock_skew'
};
class Timekeeper extends EventEmitter {
    db;
    config;
    manager;
    stopped = true;
    cronMonitorInterval;
    skewMonitorInterval;
    timekeeping;
    _checkingSkew = false;
    clockSkew = 0;
    events = EVENTS;
    constructor(db, manager, config) {
        super();
        this.db = db;
        this.config = config;
        this.manager = manager;
    }
    get checkingSkew() {
        return this._checkingSkew;
    }
    get warningContext() {
        return {
            emitter: this,
            db: this.db,
            schema: this.config.schema,
            persistWarnings: this.config.persistWarnings,
            warningEvent: this.events.warning,
            errorEvent: this.events.error
        };
    }
    async start() {
        this.stopped = false;
        await this.cacheClockSkew();
        await this.manager.createQueue(QUEUES.SEND_IT);
        const options = {
            pollingIntervalSeconds: this.config.cronWorkerIntervalSeconds,
            batchSize: 50
        };
        await this.manager.work(QUEUES.SEND_IT, options, (jobs) => this.onSendIt(jobs));
        setImmediate(() => this.onCron());
        this.cronMonitorInterval = setInterval(async () => await this.onCron(), this.config.cronMonitorIntervalSeconds * 1000);
        this.skewMonitorInterval = setInterval(async () => await this.cacheClockSkew(), this.config.clockMonitorIntervalSeconds * 1000);
    }
    async stop() {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        await this.manager.offWork(QUEUES.SEND_IT, { wait: true });
        if (this.skewMonitorInterval) {
            clearInterval(this.skewMonitorInterval);
            this.skewMonitorInterval = null;
        }
        if (this.cronMonitorInterval) {
            clearInterval(this.cronMonitorInterval);
            this.cronMonitorInterval = null;
        }
        while (this.timekeeping || this._checkingSkew) {
            await delay(10);
        }
    }
    async cacheClockSkew() {
        let skew = 0;
        this._checkingSkew = true;
        try {
            if (this.config.__test__force_clock_monitoring_error) {
                throw new Error(this.config.__test__force_clock_monitoring_error);
            }
            if (this.config.__test__delay_clock_skew_ms) {
                await delay(this.config.__test__delay_clock_skew_ms);
            }
            const { rows } = await this.db.executeSql(plans.getTime());
            const local = Date.now();
            const dbTime = parseFloat(rows[0].time);
            skew = dbTime - local;
            const skewSeconds = Math.abs(skew) / 1000;
            if (skewSeconds >= 60 || this.config.__test__force_clock_skew_warning) {
                await emitAndPersistWarning(this.warningContext, WARNING_TYPES.CLOCK_SKEW, WARNINGS.CLOCK_SKEW.message, { seconds: skewSeconds, direction: skew > 0 ? 'slower' : 'faster' });
            }
            this.clockSkew = skew;
        }
        catch (err) {
            this.emit(this.events.error, err);
        }
        finally {
            this._checkingSkew = false;
        }
    }
    async onCron() {
        try {
            if (this.stopped || this.timekeeping)
                return;
            if (this.config.__test__force_cron_monitoring_error) {
                throw new Error(this.config.__test__force_cron_monitoring_error);
            }
            this.timekeeping = true;
            const sql = plans.trySetCronTime(this.config.schema, this.config.cronMonitorIntervalSeconds);
            if (!this.stopped) {
                const { rows } = await this.db.executeSql(sql);
                if (!this.stopped && rows.length === 1) {
                    await this.cron();
                }
            }
        }
        catch (err) {
            this.emit(this.events.error, err);
        }
        finally {
            this.timekeeping = false;
        }
    }
    async cron() {
        const schedules = await this.getSchedules();
        const scheduled = schedules
            .filter(i => this.shouldSendIt(i.cron, i.timezone))
            .map(({ name, key, data, options }) => ({ data: { name, data, options }, singletonKey: `${name}__${key}`, singletonSeconds: 60 }));
        if (scheduled.length > 0 && !this.stopped) {
            await this.manager.insert(QUEUES.SEND_IT, scheduled);
        }
    }
    shouldSendIt(cron, tz) {
        const databaseTime = Date.now() + this.clockSkew;
        const interval = CronExpressionParser.parse(cron, { tz, strict: false, currentDate: new Date(databaseTime) });
        const prevTime = interval.prev();
        const prevDiff = (databaseTime - prevTime.getTime()) / 1000;
        return prevDiff < 60;
    }
    async onSendIt(jobs) {
        const results = await Promise.allSettled(jobs.map(({ data }) => this.manager.send(data)));
        // Surface any failed forward so a lost cron tick isn't silent
        for (const result of results) {
            if (result.status === 'rejected') {
                this.emit(this.events.error, result.reason);
            }
        }
    }
    async getSchedules(name, key) {
        let sql = plans.getSchedules(this.config.schema);
        let params = [];
        if (name && key !== undefined) {
            sql = plans.getSchedulesByQueueAndKey(this.config.schema);
            params = [name, key];
        }
        else if (name) {
            sql = plans.getSchedulesByQueue(this.config.schema);
            params = [name];
        }
        const { rows } = await this.db.executeSql(sql, params);
        return rows;
    }
    async schedule(name, cron, data, options = {}) {
        const { tz = 'UTC', key = '', ...rest } = options;
        CronExpressionParser.parse(cron, { tz, strict: false });
        Attorney.checkSendArgs([name, data, { ...rest }]);
        Attorney.assertKey(key);
        try {
            const sql = plans.schedule(this.config.schema);
            await this.db.executeSql(sql, [name, key, cron, tz, data, options]);
        }
        catch (err) {
            if (err.message.includes('foreign key')) {
                err.message = `Queue ${name} not found`;
            }
            throw err;
        }
    }
    async unschedule(name, key = '') {
        const sql = plans.unschedule(this.config.schema);
        await this.db.executeSql(sql, [name, key]);
    }
}
export default Timekeeper;
