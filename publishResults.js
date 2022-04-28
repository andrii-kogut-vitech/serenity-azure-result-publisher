const fs = require('fs')
const devAzureClient = require('./devAzureClient.js')
require('dotenv').config();


class PublishResults {
    azure = new devAzureClient({
        'userName': process.env.AZURE_USER_NAME,
        'token': process.env.AZURE_TOKEN,
        'organization': process.env.AZURE_ORGANIZATION,
        'projectId': process.env.AZURE_PROJECT_ID,
        'testPlanId': process.env.AZURE_TEST_PLAN_ID,
        'testSuiteParentId': process.env.AZURE_TEST_SUITE_PARENT_ID
    });


    statusMap = {
        'SUCCESS': 'Passed',
        'ERROR': 'Failed',
        'FAILURE': 'Failed',
        'SKIPPED': 'NotExecuted',
        'IGNORED': 'NotApplicable'
    };


    getListOfFiles(src = process.env.JSON_INPUT_PATH) {
        let jsonFiles = [];
        let files = fs.readdirSync(src)
        files.forEach(file => {
            if (file.includes('json')) {
                jsonFiles.push(file)
            }
            ;
        });
        return jsonFiles;
    }

    readContent(filename) {
        return JSON.parse(fs.readFileSync(process.env.JSON_INPUT_PATH + filename))
    }

    addStep(step) {
        return {
            "parameterizedString": [{'#text': step}, {'#text': ""}]
        }
    }

    addResult(name, testCaseId, testPointId, testSuiteId, testCaseObject) {
        let result = {
            "testCaseTitle": name, "testCaseRevision": 1, "testCase": {
                "id": testCaseId
            },
            "testPoint": {
                "id": testPointId
            },
            "testSuite": {
                "id": testSuiteId
            },
            "testPlan": {
                "id": process.env.AZURE_TEST_PLAN_ID
            },
            "outcome": this.statusMap[testCaseObject.result],
            "state": "Completed"
        }
        if (testCaseObject.exception) {
            let exception = JSON.stringify(testCaseObject.exception, undefined, 4)
            result.stackTrace = exception
        }
        return result;
    }

    processResults() {
        let result = []
        let testRunId = this.azure.addTestRun()
        let jsonFiles = this.getListOfFiles();
        for (let fileNameSequence = 0; fileNameSequence < jsonFiles.length; fileNameSequence++) {
            let json = this.readContent(jsonFiles[fileNameSequence]);
            let folderName = json.featureTag.name.split('/')[0];
            let suiteId = this.azure.getSuiteIdByTitle(folderName);
            let groupName = json.featureTag.name.split('/')[1];
            for (let testCaseSequence = 0; testCaseSequence < json.testSteps.length; testCaseSequence++) {
                let testCaseName = groupName;
                for (let paramSequence = 0; paramSequence < json.dataTable.rows[testCaseSequence].values.length; paramSequence++) {
                    testCaseName = testCaseName + `: ${json.dataTable.rows[testCaseSequence].values[paramSequence]}`
                }
                let steps = []
                let testCaseKey = this.azure.getTestCaseIdByTitle(testCaseName, suiteId)
                this.azure.addTestCaseIssueLink(testCaseKey, json.coreIssues)
                let testCaseObject = json.testSteps[testCaseSequence]
                let testSteps = testCaseObject.children;
                let testPointId = this.azure.getTestPoints(suiteId, testCaseKey)
                result.push(this.addResult(testCaseName, testCaseKey, testPointId, suiteId, testCaseObject))
                if (testSteps) {
                    testSteps.forEach(step => {
                        steps.push(this.addStep(step.description))
                    });
                }
                this.azure.addStepsToTestCase(testCaseKey, steps)
            }
        }
        this.azure.publishResults(testRunId, result)
        this.azure.completeTestRun(testRunId)
    }

}

module.exports = PublishResults;
