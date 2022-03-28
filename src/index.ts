import { types as mstTypes } from "mobx-state-tree";
import { array } from "./array";
import { frozen } from "./frozen";
import { late } from "./late";
import { map } from "./map";
import { model } from "./model";
import { optional } from "./optional";
import { literal, SimpleType } from "./simple";

export const types = {
  boolean: SimpleType.for(mstTypes.boolean),
  Date: SimpleType.for(mstTypes.Date),
  identifier: SimpleType.for(mstTypes.identifier),
  integer: SimpleType.for(mstTypes.integer),
  null: SimpleType.for(mstTypes.null),
  number: SimpleType.for(mstTypes.number),
  string: SimpleType.for(mstTypes.string),

  array,
  frozen,
  late,
  literal,
  map,
  model,
  optional,
};
