import Ajv, { type ValidateFunction } from 'ajv';
import { METHODS, type MethodName } from './methods.ts';

/**
 * Compiled params validators for every bridge method. Kept out of the SDK bundle (the SDK must
 * stay < 15 KB); the shell validates on the privileged side (CORE-12).
 */
export function compileParamValidators(): Record<MethodName, ValidateFunction> {
  const ajv = new Ajv({ allErrors: false, strict: true, allowUnionTypes: true });
  const out = {} as Record<MethodName, ValidateFunction>;
  for (const [name, spec] of Object.entries(METHODS) as [MethodName, (typeof METHODS)[MethodName]][]) {
    out[name] = ajv.compile(spec.params);
  }
  return out;
}

export function describeAjvError(validate: ValidateFunction): string {
  const e = validate.errors?.[0];
  if (!e) return 'invalid params';
  return `${e.instancePath || 'params'} ${e.message ?? 'is invalid'}`.trim();
}
