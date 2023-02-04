import type { IModelType as MSTIModelType, ModelActions } from "mobx-state-tree";
import { types as mstTypes } from "mobx-state-tree";
import "reflect-metadata";
import { RegistrationError } from "./errors";
import { defaultThrowAction, instantiateInstanceFromProperties, mstPropsFromQuickProps, propsFromModelPropsDeclaration } from "./model";
import { $env, $parent, $readOnly, $registered, $requiresRegistration, $type, $volatileDefiner } from "./symbols";
import type {
  IAnyType,
  IClassModelType,
  InputsForModel,
  InputTypesForModelProps,
  InstantiateContext,
  ModelPropertiesDeclaration,
  ModelViews,
  TypesForModelPropsDeclaration,
} from "./types";

/** @internal */
type ActionMetadata = {
  type: "action";
  property: string;
};

/** @internal */
type ViewMetadata = {
  type: "view";
  property: string;
};

/** @internal */
export type VolatileMetadata = {
  type: "volatile";
  property: string;
  initializer: VolatileInitializer<any>;
};

type VolatileInitializer<T> = (instance: T) => Record<string, any>;
type PropertyMetadata = ActionMetadata | ViewMetadata | VolatileMetadata;

const metadataPrefix = "mqt:properties";
const viewKeyPrefix = `${metadataPrefix}:view`;
const actionKeyPrefix = `${metadataPrefix}:action`;
const volatileKeyPrefix = `${metadataPrefix}:volatile`;

/**
 * A map of property keys to indicators for how that property should behave on the registered class
 **/
export type RegistrationTags<T> = {
  [key in keyof T]: typeof action | typeof view | VolatileDefiner;
};

/**
 * Create a new base class for a ClassModel to extend. This is a function that you call that returns a class (a class factory).
 *
 * @example
 *
 * class MyModel extends ClassModel({ name: types.string }) {
 *   get upperCasedName() {
 *     return this.name.toUpperCase();
 *   }
 *
 *   @action
 *   setName(name: string) {
 *     this.name = name;
 *   }
 * }
 */
export const ClassModel = <PropsDeclaration extends ModelPropertiesDeclaration>(
  propertiesDeclaration: PropsDeclaration
): IClassModelType<TypesForModelPropsDeclaration<PropsDeclaration>> => {
  const props = propsFromModelPropsDeclaration(propertiesDeclaration);
  return class Base {
    static isMQTClassModel = true as const;
    static properties = props;
    static mstType: MSTIModelType<any, any>;
    static readonly [$requiresRegistration] = true;

    /** @hidden */
    readonly [$env]?: any;
    /** @hidden */
    readonly [$parent] = null;

    constructor(
      attrs?: InputsForModel<InputTypesForModelProps<TypesForModelPropsDeclaration<PropsDeclaration>>>,
      env?: any,
      context?: InstantiateContext,
      /** @hidden */ hackyPreventInitialization = false
    ) {
      if (hackyPreventInitialization) {
        return;
      }

      const klass = this.constructor as IClassModelType<any>;

      const isRoot = !context;
      context ??= {
        referenceCache: new Map(),
        referencesToResolve: [],
        env,
      };

      this[$env] = env;
      instantiateInstanceFromProperties(this, attrs, props, klass.mstType.identifierAttribute, context);
      initializeVolatiles(this, this, klass.volatiles);

      if (isRoot) {
        for (const resolver of context.referencesToResolve) {
          resolver();
        }
      }
    }

    get [$readOnly]() {
      return true;
    }

    get [$type]() {
      return this.constructor as IClassModelType<TypesForModelPropsDeclaration<PropsDeclaration>>;
    }
  } as any;
};

/**
 * Class decorator for registering MQT class models as setup.
 *
 * @example
 * ```
 *   @register
 *   class Example extends ClassModel({ name: types.string }) {
 *     get bigName() {
 *       return this.name.toUpperCase();
 *     }
 *   }
 * ```
 */
export function register<Instance, Klass extends { new (...args: any[]): Instance }>(
  object: Klass,
  tags?: RegistrationTags<Instance>,
  name?: string
) {
  const klass = object as any as IClassModelType<any>;
  const mstActions: ModelActions = {};
  const mstViews: ModelViews = {};
  const mstVolatiles: Record<string, VolatileMetadata> = {};

  // get the metadata for each property from either the decorators on the class or the explicitly passed tags
  const metadatas = tags ? getExplicitMetadataFromTags(tags) : getReflectionMetadata(klass);
  const explicitKeys = new Set<string>(metadatas.map((metadata) => metadata.property));

  for (const property of allPrototypeFunctionProperties(klass.prototype)) {
    if (explicitKeys.has(property)) continue;
    metadatas.push({
      type: "view",
      property,
    });
  }

  for (const metadata of metadatas) {
    switch (metadata.type) {
      case "view": {
        const descriptor = Object.getOwnPropertyDescriptor(klass.prototype, metadata.property);
        if (!descriptor) {
          throw new RegistrationError(`Property ${metadata.property} not found on ${klass} prototype, can't register view for class model`);
        }
        Object.defineProperty(mstViews, metadata.property, {
          ...Object.getOwnPropertyDescriptor(klass.prototype, metadata.property),
          enumerable: true,
        });
        break;
      }
      case "action": {
        let target: any;
        if (metadata.property in klass.prototype) {
          target = klass.prototype;
        } else {
          // hackily instantiate the class to get at the instance level properties defined by the class body (those that aren't on the prototype)
          target = new (klass as any)({}, undefined, undefined, true);
        }
        const descriptor = Object.getOwnPropertyDescriptor(target, metadata.property);

        if (!descriptor) {
          throw new RegistrationError(
            `Property ${metadata.property} not found on ${klass} prototype or instance, can't register action for class model`
          );
        }

        // add the action to the MST actions we'll add to the MST model type
        Object.defineProperty(mstActions, metadata.property, {
          ...descriptor,
          enumerable: true,
        });

        // mark the action as not-runnable on the readonly class
        Object.defineProperty(klass.prototype, metadata.property, {
          ...descriptor,
          enumerable: true,
          value: defaultThrowAction(metadata.property),
        });

        break;
      }
      case "volatile": {
        mstVolatiles[metadata.property] = metadata;
      }
    }
  }

  if (name) {
    Object.defineProperty(klass, "name", { value: name });
  }

  klass.volatiles = mstVolatiles;

  // conform to the API that the other MQT types expect for creating instances
  klass.instantiate = (snapshot, context) => new klass(snapshot, context.env, context);
  (klass as any).is = (value: any) => value instanceof klass || klass.mstType.is(value);
  klass.create = (snapshot, env) => klass.mstType.create(snapshot, env);
  klass.createReadOnly = (snapshot, env) => new klass(snapshot, env) as any;

  // create the MST type for not-readonly versions of this using the views and actions extracted from the class
  klass.mstType = mstTypes
    .model(klass.name, mstPropsFromQuickProps(klass.properties))
    .views((self) => bindToSelf(self, mstViews))
    .actions((self) => bindToSelf(self, mstActions));

  if (Object.keys(mstVolatiles).length > 0) {
    // define the volatile properties in one shot by running any passed initializers
    (klass as any).mstType = (klass as any).mstType.volatile((self: any) => initializeVolatiles({}, self, mstVolatiles));
  }

  (klass as any)[$registered] = true;

  return klass as any;
}

/**
 * Function decorator for registering MST actions within MQT class models.
 */
export const action = (target: any, property: string) => {
  const metadata: ActionMetadata = { type: "action", property };
  Reflect.defineMetadata(`${actionKeyPrefix}:${property}`, metadata, target);
};

/**
 * Function decorator for registering MST views within MQT class models.
 */
export const view = (target: any, property: string, _descriptor: PropertyDescriptor) => {
  const metadata: ViewMetadata = { type: "view", property };
  Reflect.defineMetadata(`${viewKeyPrefix}:${property}`, metadata, target);
};

/**
 * A function for defining a volatile
 **/
export type VolatileDefiner = ((target: any, property: string) => void) & { [$volatileDefiner]: true; initializer: (instance: any) => any };

/**
 * Function decorator for registering MST volatiles within MQT class models.
 */
export function volatile(initializer: (instance: any) => any): VolatileDefiner {
  return Object.assign(
    (target: any, property: string) => {
      const metadata: VolatileMetadata = { type: "volatile", property: property, initializer };
      Reflect.defineMetadata(`${volatileKeyPrefix}:${property}`, metadata, target);
    },
    {
      [$volatileDefiner]: true,
      initializer,
    } as const
  );
}

/**
 * Ensure a given type is registered if it requires registration.
 * Throws an error if a type requires registration but has not been registered.
 * @hidden
 */
export const ensureRegistered = (type: IAnyType) => {
  let chain = type;
  while (chain) {
    if ((chain as any)[$requiresRegistration]) {
      if (!(type as any)[$registered]) {
        throw new Error(
          `Type ${type.name} requires registration but has not been registered yet. Add the @register decorator to it for it to function correctly.`
        );
      }
      break;
    }
    chain = Object.getPrototypeOf(chain);
  }
};

function initializeVolatiles(result: Record<string, any>, node: Record<string, any>, volatiles: Record<string, VolatileMetadata>) {
  for (const [key, metadata] of Object.entries(volatiles)) {
    result[key] = metadata.initializer(node);
  }
  return result;
}

function bindToSelf<T extends Record<string, any>>(self: object, inputs: T): T {
  const outputs = {} as T;
  for (const [key, property] of Object.entries(Object.getOwnPropertyDescriptors(inputs))) {
    if (typeof property.value === "function") {
      property.value = property.value.bind(self);
    }
    if (typeof property.get === "function") {
      property.get = property.get.bind(self);
    }
    if (typeof property.set === "function") {
      property.set = property.set.bind(self);
    }
    Object.defineProperty(outputs, key, property);
  }
  return outputs;
}

function getExplicitMetadataFromTags(tags: RegistrationTags<any>): PropertyMetadata[] {
  return Object.entries(tags).map(([property, tag]) => {
    if (tag == view) {
      return {
        type: "view",
        property,
      };
    } else if (tag == action) {
      return {
        type: "action",
        property,
      };
    } else if ($volatileDefiner in tag) {
      return {
        type: "volatile",
        property,
        initializer: tag.initializer,
      };
    } else {
      throw new Error(`Unknown metadata tag for property ${property}: ${tag}`);
    }
  });
}

function getReflectionMetadata(klass: IClassModelType<any>): PropertyMetadata[] {
  // list all keys defined at the prototype level to search for volatiles and actions
  return Reflect.getMetadataKeys(klass.prototype)
    .filter((key) => key.startsWith(metadataPrefix))
    .map((metadataKey) => Reflect.getMetadata(metadataKey, klass.prototype) as ActionMetadata | ViewMetadata | VolatileMetadata);
}

const objectPrototype = Object.getPrototypeOf({});
// eslint-disable-next-line @typescript-eslint/no-empty-function
const functionPrototype = Object.getPrototypeOf(() => {});

function allPrototypeFunctionProperties(obj: any): string[] {
  const properties = new Set<string>();
  let currentObj = obj;

  while (currentObj && currentObj !== objectPrototype && currentObj !== functionPrototype) {
    for (const [property, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(currentObj))) {
      if (typeof descriptor.value === "function" || descriptor.get) {
        properties.add(property);
      }
    }
    currentObj = Object.getPrototypeOf(currentObj);
  }

  return [...properties.keys()].filter((key) => key != "constructor");
}