import _ from "lodash";

export const calculateAvg = (values: number[]) => {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
};

export const roundToTwoDecimals = (value?: number) => {
  return !_.isNil(value) ? (Math.round(value * 100) / 100).toFixed(2) : "-";
};
