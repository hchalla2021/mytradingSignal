'use strict';

module.exports = function cssHmrLoader(source) {
  const unsafeRemoval = /(\b[A-Za-z_$][\w$]*)\.parentNode\.removeChild\(\1\)/g;
  let replacements = 0;
  const result = source.replace(unsafeRemoval, (_, element) => {
    replacements++;
    return `${element}.remove()`;
  });
  if (replacements !== 2) {
    throw new Error('Next CSS HMR runtime changed. Recheck the detached-stylesheet compatibility fix.');
  }
  return result;
};
