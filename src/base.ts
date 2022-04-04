import type { IAnyType as AnyMSTType, Instance as MSTInstance } from "mobx-state-tree";
import { $env, $parent, $quickType, $type } from "./symbols";
import type { IAnyType, InstantiateContext, StateTreeNode } from "./types";

export abstract class BaseType<InputType, OutputType, InstanceType, MSTType extends AnyMSTType> {
  readonly [$quickType] = undefined;

  readonly InputType!: InputType;
  readonly OutputType!: OutputType;
  readonly InstanceType!: StateTreeNode<InstanceType, this>;
  readonly InstanceTypeWithoutSTN!: InstanceType;

  constructor(readonly name: string, readonly mstType: MSTType) {
    Reflect.defineProperty(this, "mstType", {
      value: mstType,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  create(snapshot?: this["InputType"], env?: any): MSTInstance<MSTType> {
    return this.mstType.create(snapshot, env);
  }

  is(value: any): value is this["InstanceType"] {
    return this.mstType.is(value);
  }

  createReadOnly(snapshot?: InputType, env?: any): this["InstanceType"] {
    const context: InstantiateContext = {
      referenceCache: {},
      referencesToResolve: [],
      env,
    };

    const instance = this.instantiate(snapshot, context);
    for (const resolver of context.referencesToResolve) {
      resolver();
    }

    const maybeObjectInstance: unknown = instance;
    if (typeof maybeObjectInstance === "object" && maybeObjectInstance !== null) {
      Reflect.defineProperty(maybeObjectInstance, $env, {
        value: env,
        configurable: false,
        enumerable: false,
        writable: false,
      });
    }

    return instance;
  }

  abstract instantiate(snapshot: this["InputType"] | undefined, context: InstantiateContext): this["InstanceType"];
}

/** @hidden */
export const setType = (value: unknown, type: IAnyType) => {
  if (value && typeof value == "object") {
    Reflect.defineProperty(value, $type, {
      value: type,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  }
};

/** @hidden */
export const setParent = (value: unknown, parent: any) => {
  if (value && typeof value == "object") {
    Reflect.defineProperty(value, $parent, {
      value: parent,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  }
};
