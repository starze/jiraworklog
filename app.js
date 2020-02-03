const inquirer = require("inquirer");
const moment = require("moment");
const rest = require("superagent");
const Conf = require('conf');

const config = require("./config");

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
const configstore = new Conf();
moment.locale('de');

/**
 * Calculates date past. Reason: If you book on monday for the previous day you want the booking to happen on friday.
 */
const calculateDatePast = () => {
    const weekDay = moment().weekday();
    const subtractDays = weekDay === 0 ? 3 : 1;
    return moment().subtract(subtractDays, "days");
};

const dateNow = moment();
const datePast = calculateDatePast();

/**
 * Resolves with user and password configuration
 * @param {Object} defaults - The default user and password
 * @returns {Promise} Resolves with user and password
 */
const getCredentials = async (defaults = {}) => {
    const answers = await inquirer.prompt([{
        type: "input",
        name: "user",
        message: "Für welchen Benutzer möchtest du buchen",
        default: () => configstore.get("user"),
    }, {
        type: "password",
        name: "password",
        message: answers => `Passwort für den Benutzer ${answers.user || defaults.user}`,
        when: () => !defaults.password,
    }]);
    configstore.set("user", answers.user);
    return {
        user: answers.user,
        password: defaults.password || answers.password,
    };
};

/**
 * Returns the last issues.
 * @returns {string[]} Returns the last issues.
 */
const getLastIssues = () => (configstore.get("lastIssues") || []);
/**
 * Adds given issue to lastIssues cache.
 * @param {string} issue - The issue to add
 */
const addToLastIssues = (issue) => {
    let lastIssues = getLastIssues();
    // remove entry if it is already existing
    const idx = lastIssues.findIndex(v => v === issue);
    if (idx >= 0) {
        lastIssues.splice(idx, 1);
    }
    // add issue as first element in list
    lastIssues.unshift(issue);
    // trim list to maxLastIssues
    if (lastIssues.length > config.maxLastIssues) {
        lastIssues.splice(config.maxLastIssues);
    }
    // save lastIssues
    configstore.set("lastIssues", lastIssues.filter(v => !!v));
};

const addWorklog = async (credentials) => {
    let localCredentials = credentials;
    let answers = await inquirer.prompt([
        {
            type: "list",
            name: "issueSelection",
            message: "Welchen Issue willst du buchen",
            choices: [
                ...getLastIssues(),
                "custom",
                ...config.issues,
            ],
        },
        {
            type: "input",
            name: "issue",
            when: answers => answers.issueSelection === "custom",
            filter: value => (/^[0-9].*/.test(value) ? `TXR-${value}` : value),
        },
        {
            type: "input",
            name: "time",
            message: "Wieviel Zeit willst du buchen",
        },
        {
            type: "confirm",
            name: "bookYesterday",
            message: "Soll die Buchung auf den gestrigen Tag?",
        },
    ]);

    let issue = answers.issueSelection;
    if (answers.issueSelection === "custom") {
        addToLastIssues(answers.issue);
        issue = answers.issue;
    }

    const dateToBook = answers.bookYesterday ? datePast : dateNow;
    const postData = {
        timeSpent: answers.time,
        started: dateToBook.toISOString().replace("Z", "+0000"),
    };

    console.log(`Book: '${JSON.stringify(postData)}' on issue '${issue}'`);

    try {
        await rest.post(`https://zue-s-210/jira/rest/api/latest/issue/${issue}/worklog`, postData)
            .auth(localCredentials.user, localCredentials.password);
    } catch (err) {
        if (err.statusCode === 401) { // Unauthorized
            console.log("Wrong username/password given.");
            localCredentials = await getCredentials(); // no defaults. User has to type in user and password
        } else {
            console.log(`Failed to add worklog: Reason: ${err.message}`);
        }
    }

    answers = await inquirer.prompt([{
        type: "confirm",
        name: "continue",
        message: "Weitere Buchung durchführen",
    }]);

    if (answers.continue) {
        await addWorklog(localCredentials);
    }
};

(async () => {
    try {
        console.log(`\nWilkommen beim JIRA worklog tool.\nBuchen auf "gestern" bezieht sich auf den "${datePast.format('dddd[,] LL')}".`);
        const credentials = await getCredentials({ password: process.env["JIRA_PASS"] });
        await addWorklog(credentials);
    } catch (error) {
        console.error(error);
    }
})();
