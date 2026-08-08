import { DynamicKnot } from './tree';
export declare class DynamicProcessor {
    processDynamicOutput(output: string): DynamicKnot;
    flattenPredicates(predicates: any): any;
    handleObjectFlags(objectName: string, flags: Record<string, boolean>): void;
    extractChanges(oldState: DynamicKnot, newState: DynamicKnot): Array<{
        type: 'global' | 'object';
        name: string;
        field: string | null;
        oldValue: any;
        newValue: any;
    }>;
}
//# sourceMappingURL=dynamic.d.ts.map