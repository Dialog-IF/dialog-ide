"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectConfig = exports.defaultConfig = void 0;
exports.defaultConfig = {
    process: {
        timeout: 30000,
        maxRetries: 3
    },
    tree: {
        maxKnots: 10000,
        memoryLimit: 100
    },
    service: {
        port: 3000,
        host: 'localhost',
        enableSse: true
    },
    fileFormat: {
        version: '1.0.0',
        encoding: 'utf8',
        compression: 'none'
    }
};
exports.projectConfig = {
    name: 'Dialog IDE',
    version: '1.0.0',
    description: 'IDE for Dialog interactive fiction development with Skein engine',
    author: 'Howard Lewis Ship',
    license: 'MIT'
};
//# sourceMappingURL=config.js.map