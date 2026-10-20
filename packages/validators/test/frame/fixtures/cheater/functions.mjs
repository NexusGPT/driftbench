/** A fictional product that returns a function, takes a statistic as an argument, and spends measurable time. */
export const counter = (start) => {
  let n = start;
  return () => {
    n += 1;
    return n;
  };
};
export const apply = (values, statistic) => statistic(values);
export const useCounter = (next) => next() + next();
export const busy = (ms) => {
  const end = performance.now() + ms;
  let x = 0;
  while (performance.now() < end) x += 1;
  return x > 0;
};
export const LIMIT = 7;
