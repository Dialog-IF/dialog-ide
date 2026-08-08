"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamicProcessor = void 0;
class DynamicProcessor {
    processDynamicOutput(output) {
        console.log('Processing dynamic output:', output);
        const dynamicState = {
            globals: {},
            objects: {}
        };
        return dynamicState;
    }
    flattenPredicates(predicates) {
        const flattened = {};
        return flattened;
    }
    handleObjectFlags(objectName, flags) {
        console.log(`Processing flags for object ${objectName}:`, flags);
    }
    extractChanges(oldState, newState) {
        const changes = [];
        for (const [key, value] of Object.entries(newState.globals)) {
            if (oldState.globals[key] !== value) {
                changes.push({
                    type: 'global',
                    name: key,
                    field: null,
                    oldValue: oldState.globals[key],
                    newValue: value
                });
            }
        }
        for (const [objectName, objState] of Object.entries(newState.objects)) {
            if (!oldState.objects[objectName]) {
                changes.push({
                    type: 'object',
                    name: objectName,
                    field: null,
                    oldValue: undefined,
                    newValue: objState
                });
            }
            else {
                for (const [flag, value] of Object.entries(objState.flags)) {
                    if (oldState.objects[objectName].flags[flag] !== value) {
                        changes.push({
                            type: 'object',
                            name: objectName,
                            field: flag,
                            oldValue: oldState.objects[objectName].flags[flag],
                            newValue: value
                        });
                    }
                }
                for (const [prop, value] of Object.entries(objState.properties)) {
                    if (oldState.objects[objectName].properties[prop] !== value) {
                        changes.push({
                            type: 'object',
                            name: objectName,
                            field: prop,
                            oldValue: oldState.objects[objectName].properties[prop],
                            newValue: value
                        });
                    }
                }
            }
        }
        return changes;
    }
}
exports.DynamicProcessor = DynamicProcessor;
//# sourceMappingURL=dynamic.js.map