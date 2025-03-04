const util = require('util');

/**
 * All browser drivers must do the following things:
 * - Open a page to ROOT_URL
 * - send all console messages to the stdout function
 * - send all errors to the stderr function, only when window.testsAreRunning is false
 * - When window.testsDone becomes true, call `done` with window.testFailures argument
 * - As a safeguard, exit with code 2 if there hasn't been console output
 *   for 30 seconds.
 */

let driver;

// Make sure the chromedriver process does not stick around
process.on('exit', () => {
  if (driver) {
    driver.quit();
  }
});

export default function startChrome({
  stdout,
  stderr,
  done,
}) {
  let chromedriver;
  let webdriver;
  let logging;
  let chrome;
  try {
    require('chromedriver');
    webdriver = require('selenium-webdriver');
    logging = require('selenium-webdriver/lib/logging');
    chrome = require('selenium-webdriver/chrome');
  } catch (error) {
    console.error(error);
    throw new Error(
      'When running app tests with TEST_BROWSER_DRIVER=chrome, you must first ' +
      '"npm i --save-dev selenium-webdriver@3.0.0-beta-2 chromedriver"'
    );
  }

  // Get the driver instance. By default, chromedriver gives us only errors
  // so we need to set browser logging level to "ALL".
  const options = new chrome.Options();
  if (!process.env.TEST_BROWSER_VISIBLE) options.addArguments('--headless');
  // Pass additional chrome options as appropriate
  if (process.env.TEST_CHROME_ARGS) {
    // Convert any appearances of "%20" to " " so as to support spaces in arguments if necessary
    let additionalOptions = process.env.TEST_CHROME_ARGS
        .split(/\s+/)
        .map((arg) => arg.replace(/%20/g, " "));
    options.addArguments.apply(options, additionalOptions);
  }
  driver = new webdriver.Builder().forBrowser('chrome').withCapabilities(chrome.Options.chrome()).setChromeOptions(options).setLoggingPrefs({ browser: 'ALL' }).build();

  // Can't hide the window but can move it off screen
  driver.manage().window().setRect(20000, 20000);

  // We periodically grab logs from Chrome and pass them back.
  // Every time we call this, we get only the log entries since
  // the previous time we called it.
  function passThroughLogs() {
    return driver.manage().logs().get(logging.Type.BROWSER)
      .then(entries => {
        (entries || []).forEach(entry => {
          let message = entry.message || '';
          if (entry.level.name === 'SEVERE') {
            stderr(`[ERROR] ${message}`);
          } else {
            function extractArgs(str) {
              let rex = /"([^"]*)"|(\b\d+\b)/g;
              let match;
              let args = [];
              while ((match = rex.exec(str)) !== null) {
                let stringArg = match[1];
                let numberArg = match[2];
                if (stringArg !== undefined) {
                  // string argument found (can be empty)
                  args.push(stringArg);
                } else if (numberArg !== undefined) {
                  // number argument found
                  args.push(Number(numberArg));
                }
              }
              return args;
            }

            const [, , , ...args] = extractArgs(message);
            let formattedMessage = util.format.apply(null, args);

            const messageLines = formattedMessage.split('\\n');
            messageLines.forEach(messageLine => {
              stdout(messageLine);
            });
          }
        });
      });
  }

  // Meteor will call the `runTests` function exported by the driver package
  // on the client as soon as this page loads.
  driver.get(process.env.ROOT_URL);

  let testFailures;
  driver
    .wait(function() {
      // After the page loads, the tests are running. Eventually they
      // finish and the driver package is supposed to set window.testsDone
      // and window.testFailures at that time.
      return passThroughLogs().then(() => {
        return driver.executeScript('return window.testsDone');
      });
    }, 600000)
    .then(() => {
      // Empty the logs one last time
      return passThroughLogs();
    })
    .then(() => {
      return driver.executeScript('return window.testFailures');
    })
    .then(failures => {
      testFailures = failures;
      return driver.quit();
    })
    .then(() => {
      driver = null;
      done(testFailures);
    });
}
