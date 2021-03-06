import * as _ from 'lodash';
import { DEFAULT_REDACT_SYMBOL } from '../../src/consts';
import { ISerializedHttp } from '../http-serializer';

export type Redactor = ((value: any, path: string) => string);

export function defaultRedactor(): string {
  return DEFAULT_REDACT_SYMBOL;
}

/**
 * Redact properties on the matching intercepted records.
 *
 * Use a `.` to reference a nested property
 * @todo Benchmark & investigate alternatives
 * @param property  Properties to redact
 * @param redactSymbol Symbol to use for redacted properties or function to compute.
 */
export function redact(
  record: ISerializedHttp,
  properties: string[],
  redactor: Redactor = defaultRedactor,
): ISerializedHttp {
  const redacted = _.cloneDeep(record);

  properties.forEach((property) => {
    const currentValue = _.get(redacted, property);

    if (currentValue !== undefined) {
      _.set(redacted, property, redactor(currentValue, property));
    }
  });

  return redacted;
}
