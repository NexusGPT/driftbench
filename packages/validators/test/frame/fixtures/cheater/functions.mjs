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
  const start = process.cpuUsage();
  let x = 0;
  for (;;) {
    const used = process.cpuUsage(start);
    if ((used.user + used.system) / 1000 >= ms) break;
    x += 1;
  }
  return x > 0;
};
export const LIMIT = 7;
