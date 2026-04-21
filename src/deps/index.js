import fs from "fs";
import path from "path";
import process from "process";
import readline from "readline";
import dotenv from "dotenv";
import puppeteer from "puppeteer";
import puppeteerExtra from "puppeteer-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";

export function createDeps(ctx = {}) {
  const { data = {} } = ctx;
  const { logger = console } = data;

  return {
    deps: {
      fs,
      path,
      process,
      readline,
      dotenv,
      puppeteer,
      puppeteerExtra,
      stealthPlugin,
      Buffer,
      URL,
      Date,
      setTimeout,
      clearTimeout,
      logger
    }
  };
}
