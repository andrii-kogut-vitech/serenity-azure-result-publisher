const RestClient = require('./restClient.js')
let base64 = require('base-64');
let builder = require('xmlbuilder');
require('dotenv').config();


/**
 * Dev Azure basic API wrapper
 */
class DevAzureClient extends RestClient {

    /**
     * Dev Azure constructor
     *
     * @param options
     */
    constructor(options) {
        super();
        this._validate(options, 'userName');
        this._validate(options, 'token');
        this._validate(options, 'organization');
        this._validate(options, 'projectId');
        this._validate(options, 'testPlanId');
        this._validate(options, 'testSuiteParentId');


        this.options = options;
        this.base = `https://dev.azure.com/${this.options.organization}/${this.options.projectId}/_apis/`;
        this.headers = {
            "Authorization": `Basic ${base64.encode(this.options.userName + ":" + this.options.token)}`,
            "Content-Type": "application/json-patch+json",
            "Accept": "application/json; api-version=7.0"
        }

    }

    /**
     * Returns current date in 'Mon Jan 1 2020' format
     * @return {string}
     */
    getDateNow() {
        let now = new Date(Date.now())
        return now.toDateString()
    }

    getTestRunName() {
        return `Branch: ${process.env.BRANCH_NAME} (${this.getDateNow()})`
    }


    /**
     * Creates testRun in Dev Azure via API
     * @param testRunName
     * @param planId
     * @returns id of created test run
     */
    addTestRun(testRunName = this.getTestRunName(), planId = this.options.testPlanId) {
        let requestBody = {
            "name": testRunName,
            "plan": {
                "id": planId
            },
            "automated": true
        }
        let headers = JSON.parse(JSON.stringify(this.headers))
        headers["Content-Type"]="application/json"
        let response = this._post(`test/runs`, requestBody, undefined, headers)
        return response['id'];
    }

    /**
     * Creates testCase in Dev Azure via API
     * @param name
     * @param suiteId
     * @return testCaseId of created testCase
     */
    addTestCase(name, suiteId) {
        let requestBody = [
            {
                "op": "add",
                "path": "/fields/System.Title",
                "value": name
            },
            {
                "op": "add",
                "path": "/fields/System.State",
                "value": "Design"
            },
            {
                "op": "add",
                "path": "/fields/Custom.Testautomationstatus",
                "value": "Automated"
            }
        ]
        let response = this._post(`wit/workitems/$Test%20Case`, requestBody);
        let testCaseId = response['id']
        this._post(`test/Plans/${this.options.testPlanId}/suites/${suiteId}/testcases/${testCaseId}`)
        return testCaseId
    }

    /**
     * Add steps to testCase in Dev Azure via API
     * @param testCaseId
     * @param steps
     */
    addStepsToTestCase(testCaseId, steps) {
        let obj = {
            'steps': {
                "step": steps
            }
        }
        let xml = builder.create(obj).end({pretty: true});
        let requestBody = [
            {
                "op": "replace",
                "path": "/fields/Microsoft.VSTS.TCM.Steps",
                "value": xml
            }
        ]

        this._patch(`wit/workitems/${testCaseId}`, requestBody)
    }

    /**
     * Creates Suite in Dev Azure via API
     * @param name
     * @return suiteId of created section
     */
    addSuite(name, parentId = this.options.testSuiteParentId) {
        let requestBody = {
            "suiteType": "StaticTestSuite",
            "name": name,
            "parentSuite": {
                "id": parentId
            }
        }
        let headers = JSON.parse(JSON.stringify(this.headers))
        headers["Content-Type"]="application/json"
        let response = this._post(`testplan/Plans/${this.options.testPlanId}/suites`, requestBody, undefined, headers)
        return response['id']
    }

    /**
     * Filter test cases response
     * @param data data
     * @return {{}}
     */
    filterTestCasesResponse(data) {
        let dict = {};
        for (let i = 0; i < data.length; i++) {
            dict[data[i].workItem.name] = data[i].workItem.id;
        }
        return dict
    }

    /**
     * Gets data and returns data matched to key and value
     * @param data
     * @param key
     * @param value
     * @return {{}}
     */
    getDataDictByParams(data, key, value) {
        let dict = {};
        for (let i = 0; i < data.length; i++) {
            dict[data[i][key]] = data[i][value];
        }
        return dict
    }

    /**
     * Gets testCaseId based on title and section
     * in cases there is no such testCase in section, it will be created
     * @param title
     * @param suiteId
     * @return testCaseId
     */
    getTestCaseIdByTitle(title, suiteId) {
        let data = this._get(`testplan/Plans/${this.options.testPlanId}/Suites/${suiteId}/TestCase?excludeFlags=3&witFields=System.WorkItemType%2CSystem.Title`)
        data = data.value
        data = this.filterTestCasesResponse(data)
        let cases = [];
        for (let i = 0; i < data.length; i++) {

        }
        for (let name in data) {
            if (name === title) {
                cases.push(data[name])
            }
        }
        if (cases.length > 1) {
            throw new Error(`In suite ${suiteId} were found ${cases.length} cases with the same test case name - ${title}`)
        } else if (cases.length === 0) {
            return this.addTestCase(title, suiteId)
        } else {
            return cases[0]
        }
    }

    /**
     * Gets suiteId based on title
     * in cases there is no such section, it will be created
     * @param title
     * @param suiteName
     * @return suiteId
     */
    getSuiteIdByTitle(suiteName, title) {
        if (suiteName === undefined) {
            throw new Error(`TestCase "${title}" does not have suite name, please add it`)
        }
        let data = this._get(`testplan/Plans/${this.options.testPlanId}/suites/${this.options.testSuiteParentId}?expand=children`)
        data = data.children
        // data = this.filterJson(data, 'parentId', this.options.parentId)
        data = this.getDataDictByParams(data, 'name', 'id')
        let suites = [];
        for (let name in data) {
            if (name === suiteName) {
                suites.push(data[name])
            }
        }
        if (suites.length > 1) {
            throw new Error(`In project ${this.options.projectKey} were found ${suites.length} folders with the same folder name - ${name}`)
        } else if (suites.length === 0) {
            return this.addSuite(suiteName)
        } else {
            return suites[0]
        }
    }

    /**
     * Add link between testCase in Zephyr and Jira ticket
     * @param testCaseId
     * @param issueId
     */
    addTestCaseIssueLink(testCaseId, storyId) {
        if (storyId) {
            for (let i in storyId) {
                let requestBody = [
                    {
                        "op": "add",
                        "path": "/relations/-",
                        "value": {
                            "rel": "Microsoft.VSTS.Common.TestedBy-Reverse",
                            "url": `${this.base}/wit/workItems/${storyId[i]}`
                        }
                    }
                ]
                this._patch(`wit/workitems/${testCaseId}`, requestBody)
            }
        }
    }

    /**
     * Publish results into Dev Azure via API
     * @param cases
     * @param results
     */
    publishResults(runId, result) {
        let headers = JSON.parse(JSON.stringify(this.headers))
        headers["Content-Type"]="application/json"
        this._post(`test/Runs/${runId}/Results`, result, undefined, headers)
    }

    /**
     * Returns testpoint value based on testCaseId and suiteId
     * @param suiteId
     * @param testCaseId
     * @returns {*}
     */
    getTestPoints (suiteId, testCaseId) {
        return this._get(`test/Plans/${this.options.testPlanId}/Suites/${suiteId}/Points?testCaseId=${testCaseId}`).value[0].id
    }

    /**
     * Coompletes testRun
     * @param runId
     */
    completeTestRun(runId) {
        let headers = JSON.parse(JSON.stringify(this.headers))
        headers["Content-Type"]="application/json"
        let result = {}
        result.state = "Completed"
        this._patch(`test/Runs/${runId}`, result, undefined, headers)
    }
}

module.exports = DevAzureClient;
