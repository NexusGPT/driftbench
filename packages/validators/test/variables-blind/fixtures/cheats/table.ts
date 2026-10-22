// Fictional product: a reader with no prose parser that takes the meaning of every condition span from the bank's
// own span table, by importing the module the bank declares its spans in (the reference reader does exactly that).
import { buildStore } from '../../reference/readers';

export const variablesImpl = { buildStore };
