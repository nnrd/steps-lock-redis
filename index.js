'use strict';
const Redis = require("ioredis");

const DEFAULT_LOCK_OPTIONS = {
    expire: 3600, // seconds, 1 hour
    timeout: 60000, // milliseconds, 1 minute
    lockSleep: 50, // milliseconds
    value: true,
};

const chunks = (arr, size = 1000) => {
    return size ? [...Array(Math.ceil(arr.length / size))].map((_, i) => arr.slice(i * size, i * size + size)) : [arr];
};

const make = (options) => {
    const lockOptions = { ...DEFAULT_LOCK_OPTIONS, ...options?.lock };

    const redis = new Redis(options.redis);

    const activeLocks = new Set();

    const removeLocks = async () => {
        const lockChunks = chunks([...activeLocks]);
        const removes = [];
        for(const locks of lockChunks) {
            removes.push(redis.del(locks));
        }

        return await Promise.all(removes);
    };

    process.on('beforeExit', removeLocks);

    const lock = async (lockName, expire, value) => {
        const lock = await redis.set(lockName, value, 'NX', 'EX', expire);
        const res = lock ? value : null;
        return res;
    };

    const unlock = async (lockName) => {
        const lock = await redis.del(lockName);
        const res = Boolean(lock);
        return res;
    };

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    const now = () => new Date().getTime();

    const waitLock = async (lockName, expire, timeout, value) => {

        const deadline = now() + timeout;
        let lock = false;

        while(deadline > now() && !(lock = await redis.set(lockName, value, 'NX', 'EX', expire))) {
            await sleep(lockOptions.lockSleep);
        }

        const result = lock ? value : null;
        return result;
    };

    const withWaitLock = async (lockName, f, expire, timeout, value) => {
        const lock = await waitLock(lockName, expire, timeout, value);
        if (lock) {
            activeLocks.add(lockName);
            try {
                return await f();
            } finally {
                await unlock(lockName);
                activeLocks.delete(lock);
            }
        }

        const errorMessage = 'Steps lock failed: ' + lockName;
        throw new Error(errorMessage);
    };

    const withLock = (name, fn, expire, timeout, value) => {
        if (!value) {
            value = lockOptions.value;
        }

        if (!timeout) {
            timeout = lockOptions.timeout;
        }

        if (!expire) {
            expire = lockOptions.expire;
        }

        return withWaitLock(name, fn, expire, timeout, value);
    };

    return {
        withLock,
    };
};

module.exports = {
    make,
};
