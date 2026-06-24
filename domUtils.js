export const $ = (sel) => document.querySelector(sel);
export const $all = (sel) => Array.from(document.querySelectorAll(sel));
export const byId = (id) => document.getElementById(id);