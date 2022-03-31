import { CustomTypeOptions, IType as MSTType, types } from "mobx-state-tree";
import { BaseType } from "./base";
import type { InstantiateContext, IType } from "./types";

export class CustomType<InputType, OutputType> extends BaseType<
  InputType,
  OutputType,
  OutputType,
  MSTType<InputType | OutputType, InputType, OutputType>
> {
  constructor(readonly options: CustomTypeOptions<InputType, OutputType>) {
    super(options.name, types.custom<InputType, OutputType>(options));
  }

  instantiate(snapshot: InputType, _context: InstantiateContext): this["InstanceType"] {
    if (snapshot === undefined) {
      throw new Error("can't initialize custom type with undefined");
    }

    // TODO figure out how to avoid the cast, maybe need to also consider setting $parent, etc
    return this.options.fromSnapshot(snapshot) as this["InstanceType"];
  }
}

export const custom = <InputType, OutputType>(
  options: CustomTypeOptions<InputType, OutputType>
): IType<InputType, OutputType, OutputType, MSTType<InputType | OutputType, InputType, OutputType>> => {
  return new CustomType(options);
};
