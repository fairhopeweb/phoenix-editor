/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2013 - 2021 Adobe Systems Incorporated. All rights reserved.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see https://opensource.org/licenses/AGPL-3.0.
 *
 */

/*global describe, it, expect, beforeEach, beforeAll, afterEach, afterAll, waits, awaitsForDone, spyOn , awaits*/

define(function (require, exports, module) {


    var SpecRunnerUtils  = require("spec/SpecRunnerUtils"),
        FileSystem       = require("filesystem/FileSystem"),
        StringUtils      = require("utils/StringUtils"),
        Strings          = require("strings"),
        _                = require("thirdparty/lodash");

    describe("LegacyInteg: Code Inspection", function () {

        var testFolder = SpecRunnerUtils.getTestPath("/spec/CodeInspection-test-files/"),
            testWindow,
            $,
            brackets,
            CodeInspection,
            CommandManager,
            Commands  = require("command/Commands"),
            EditorManager,
            DocumentManager,
            PreferencesManager,
            prefs;

        var toggleJSLintResults = function (visible) {
            $("#status-inspection").triggerHandler("click");
            expect($("#problems-panel").is(":visible")).toBe(visible);
        };

        function createCodeInspector(name, result) {
            var provider = {
                name: name,
                // arguments to this function: text, fullPath
                // omit the warning
                scanFile: function () { return result; }
            };

            spyOn(provider, "scanFile").and.callThrough();

            return provider;
        }

        function createAsyncCodeInspector(name, result, scanTime, syncImpl) {
            var provider = {
                name: name,
                scanFileAsync: function () {
                    var deferred = new $.Deferred();
                    setTimeout(function () {
                        deferred.resolve(result);
                    }, scanTime);
                    return deferred.promise();
                }
            };
            spyOn(provider, "scanFileAsync").and.callThrough();

            if (syncImpl) {
                provider.scanFile = function () {
                    return result;
                };
                spyOn(provider, "scanFile").and.callThrough();
            }

            return provider;
        }

        function successfulLintResult() {
            return {errors: []};
        }

        function failLintResult(addFix) {
            return {
                errors: [
                    {
                        pos: { line: 1, ch: 3 },
                        message: "Some errors here and there",
                        type: CodeInspection.Type.WARNING,
                        fix: addFix?{
                            replaceText: "",
                            rangeOffset: {
                                start: 0,
                                end: 1
                            }
                        }:null
                    }
                ]
            };
        }

        // Helper functions for testing cursor position / selection range
        function fixPos(pos) {
            if (!("sticky" in pos)) {
                pos.sticky = null;
            }
        }

        let savedCopyFn;

        beforeAll(async function () {
            testWindow = await SpecRunnerUtils.createTestWindowAndRun({forceReload: true});
            // Load module instances from brackets.test
            $ = testWindow.$;
            brackets = testWindow.brackets;
            CommandManager = brackets.test.CommandManager;
            DocumentManager = brackets.test.DocumentManager;
            EditorManager = brackets.test.EditorManager;
            prefs = brackets.test.PreferencesManager.getExtensionPrefs("linting");
            CodeInspection = brackets.test.CodeInspection;
            PreferencesManager = brackets.test.PreferencesManager;
            CodeInspection.toggleEnabled(true);
            await SpecRunnerUtils.loadProjectInTestWindow(testFolder);
            savedCopyFn = testWindow.Phoenix.app.copyToClipboard;
        }, 30000);

        beforeEach(function () {
            // this is to make the tests run faster
            prefs.set(CodeInspection._PREF_ASYNC_TIMEOUT, 500);
            testWindow.Phoenix.app.copyToClipboard = savedCopyFn;
        });

        afterEach(function () {
            testWindow.closeAllFiles();
        });

        afterAll(async function () {
            testWindow.Phoenix.app.copyToClipboard = savedCopyFn;
            testWindow    = null;
            $             = null;
            brackets      = null;
            CommandManager = null;
            DocumentManager = null;
            EditorManager = null;
            await SpecRunnerUtils.closeTestWindow();
        }, 30000);

        describe("Unit level tests", function () {
            var simpleJavascriptFileEntry;

            beforeEach(function () {
                CodeInspection._unregisterAll();
                simpleJavascriptFileEntry = new FileSystem.getFileForPath(testFolder + "/errors.js");
            });

            it("should run a single registered linter", async function () {
                var codeInspector = createCodeInspector("text linter", successfulLintResult());
                CodeInspection.register("javascript", codeInspector);

                var promise = CodeInspection.inspectFile(simpleJavascriptFileEntry);

                await awaitsForDone(promise, "file linting", 5000);

                expect(codeInspector.scanFile).toHaveBeenCalled();
            });

            it("should get the correct linter given a file path", function () {
                var codeInspector1 = createCodeInspector("text linter 1", successfulLintResult());
                var codeInspector2 = createCodeInspector("text linter 2", successfulLintResult());

                CodeInspection.register("javascript", codeInspector1);
                CodeInspection.register("javascript", codeInspector2);

                var providers = CodeInspection.getProvidersForPath("test.js");
                expect(providers.length).toBe(2);
                expect(providers[0]).toBe(codeInspector1);
                expect(providers[1]).toBe(codeInspector2);
            });

            it("should return an empty array if no providers are registered", function () {
                expect(CodeInspection.getProvidersForPath("test.js").length).toBe(0);
            });

            it("should run two linters", async function () {
                var codeInspector1 = createCodeInspector("text linter 1", successfulLintResult());
                var codeInspector2 = createCodeInspector("text linter 2", successfulLintResult());

                CodeInspection.register("javascript", codeInspector1);
                CodeInspection.register("javascript", codeInspector2);

                var promise = CodeInspection.inspectFile(simpleJavascriptFileEntry);

                await awaitsForDone(promise, "file linting", 5000);

                expect(codeInspector1.scanFile).toHaveBeenCalled();
                expect(codeInspector2.scanFile).toHaveBeenCalled();
            });

            it("should run one linter return some errors", async function () {
                var result;

                var codeInspector1 = createCodeInspector("javascript linter", failLintResult());
                CodeInspection.register("javascript", codeInspector1);

                var promise = CodeInspection.inspectFile(simpleJavascriptFileEntry);
                promise.done(function (lintingResult) {
                    result = lintingResult;
                });

                await awaitsForDone(promise, "file linting", 5000);

                expect(codeInspector1.scanFile).toHaveBeenCalled();
                expect(result.length).toEqual(1);
                expect(result[0].provider.name).toEqual("javascript linter");
                expect(result[0].result.errors.length).toEqual(1);
            });

            it("should run two linter and return some errors", async function () {
                var result;

                var codeInspector1 = createCodeInspector("javascript linter 1", failLintResult());
                var codeInspector2 = createCodeInspector("javascript linter 2", failLintResult());
                CodeInspection.register("javascript", codeInspector1);
                CodeInspection.register("javascript", codeInspector2);

                var promise = CodeInspection.inspectFile(simpleJavascriptFileEntry);
                promise.done(function (lintingResult) {
                    result = lintingResult;
                });

                await awaitsForDone(promise, "file linting", 5000);

                expect(result.length).toEqual(2);
                expect(result[0].result.errors.length).toEqual(1);
                expect(result[1].result.errors.length).toEqual(1);
            });

            it("should not call any other linter for javascript document", async function () {
                var codeInspector1 = createCodeInspector("any other linter linter 1", successfulLintResult());
                CodeInspection.register("whatever", codeInspector1);

                var promise = CodeInspection.inspectFile(simpleJavascriptFileEntry);

                await awaitsForDone(promise, "file linting", 5000);

                expect(codeInspector1.scanFile).not.toHaveBeenCalled();
            });

            it("should call linter even if linting on save is disabled", async function () {
                var codeInspector1 = createCodeInspector("javascript linter 1", successfulLintResult());
                CodeInspection.register("javascript", codeInspector1);

                CodeInspection.toggleEnabled(false);

                var promise = CodeInspection.inspectFile(simpleJavascriptFileEntry);

                await awaitsForDone(promise, "file linting", 5000);

                expect(codeInspector1.scanFile).toHaveBeenCalled();

                CodeInspection.toggleEnabled(true);
            });

            it("should return no result if there is no linter registered", async function () {
                var expectedResult;

                var promise = CodeInspection.inspectFile(simpleJavascriptFileEntry);
                promise.done(function (result) {
                    expectedResult = result;
                });

                await awaitsForDone(promise, "file linting", 5000);

                expect(expectedResult).toBeNull();
            });

            it("should use preferences for providers lookup", function () {
                var pm = PreferencesManager.getExtensionPrefs("linting"),
                    codeInspector1 = createCodeInspector("html1", failLintResult),
                    codeInspector2 = createCodeInspector("html2", successfulLintResult),
                    codeInspector3 = createCodeInspector("html3", successfulLintResult),
                    codeInspector4 = createCodeInspector("html4", successfulLintResult),
                    codeInspector5 = createCodeInspector("html5", failLintResult);

                CodeInspection.register("html", codeInspector1);
                CodeInspection.register("html", codeInspector2);
                CodeInspection.register("html", codeInspector3);
                CodeInspection.register("html", codeInspector4);
                CodeInspection.register("html", codeInspector5);

                function setAtLocation(name, value) {
                    pm.set(name, value, {location: {layer: "language", layerID: "html", scope: "user"}});
                }

                var providers;

                setAtLocation(CodeInspection._PREF_PREFER_PROVIDERS, ["html3", "html4"]);
                providers = CodeInspection.getProvidersForPath("my/index.html");
                expect(providers).not.toBe(null);
                expect(_.pluck(providers, "name")).toEqual(["html3", "html4", "html1", "html2", "html5"]);

                setAtLocation(CodeInspection._PREF_PREFER_PROVIDERS, ["html5", "html6"]);
                providers = CodeInspection.getProvidersForPath("index.html");
                expect(providers).not.toBe(null);
                expect(_.pluck(providers, "name")).toEqual(["html5", "html1", "html2", "html3", "html4"]);

                setAtLocation(CodeInspection._PREF_PREFER_PROVIDERS, ["html19", "html100"]);
                providers = CodeInspection.getProvidersForPath("index.html");
                expect(providers).not.toBe(null);
                expect(_.pluck(providers, "name")).toEqual(["html1", "html2", "html3", "html4", "html5"]);

                setAtLocation(CodeInspection._PREF_PREFERRED_ONLY, true);
                providers = CodeInspection.getProvidersForPath("test.html");
                expect(providers).toEqual([]);

                setAtLocation(CodeInspection._PREF_PREFER_PROVIDERS, ["html2", "html1"]);
                setAtLocation(CodeInspection._PREF_PREFERRED_ONLY, true);
                providers = CodeInspection.getProvidersForPath("c:/temp/another.html");
                expect(providers).not.toBe(null);
                expect(_.pluck(providers, "name")).toEqual(["html2", "html1"]);

                setAtLocation(CodeInspection._PREF_PREFER_PROVIDERS, undefined);
                setAtLocation(CodeInspection._PREF_PREFERRED_ONLY, undefined);
                providers = CodeInspection.getProvidersForPath("index.html");
                expect(providers).not.toBe(null);
                expect(_.pluck(providers, "name")).toEqual(["html1", "html2", "html3", "html4", "html5"]);
            });

            it("should run asynchoronous implementation when both available in the provider", async function () {
                var provider = createAsyncCodeInspector("javascript async linter with sync impl", failLintResult(), 200, true);
                CodeInspection.register("javascript", provider);

                var promise = CodeInspection.inspectFile(simpleJavascriptFileEntry);

                await awaitsForDone(promise, "file linting", 5000);

                expect(provider.scanFileAsync).toHaveBeenCalled();
                expect(provider.scanFile).not.toHaveBeenCalled();

            });

            it("should timeout on a provider that takes too long", async function () {
                var provider = createAsyncCodeInspector("javascript async linter with sync impl", failLintResult(), 1500, true),
                    result;
                CodeInspection.register("javascript", provider);

                var promise = CodeInspection.inspectFile(simpleJavascriptFileEntry);
                promise.done(function (r) {
                    result = r;
                });

                await awaitsForDone(promise, "file linting", 5000);

                expect(provider.scanFileAsync).toHaveBeenCalled();
                expect(result).toBeDefined();
                expect(result[0].provider).toEqual(provider);
                expect(result[0].errors).toBeFalsy();

            });

            it("should run two asynchronous providers and a synchronous one", async function () {
                var asyncProvider1 = createAsyncCodeInspector("javascript async linter 1", failLintResult(), 200, true),
                    asyncProvider2 = createAsyncCodeInspector("javascript async linter 2", successfulLintResult(), 300, false),
                    syncProvider3 = createCodeInspector("javascript sync linter 3", failLintResult()),
                    result;
                CodeInspection.register("javascript", asyncProvider1);
                CodeInspection.register("javascript", asyncProvider2);
                CodeInspection.register("javascript", syncProvider3);

                var promise = CodeInspection.inspectFile(simpleJavascriptFileEntry);
                promise.done(function (r) {
                    result = r;
                });

                await awaitsForDone(promise, "file linting", 5000);

                var i;
                expect(result.length).toEqual(3);

                for (i = 0; i < result.length; i++) {
                    switch (result[i].provider.name) {
                        case asyncProvider1.name:
                            expect(asyncProvider1.scanFile).not.toHaveBeenCalled();
                            expect(asyncProvider2.scanFileAsync).toHaveBeenCalled();
                            break;
                        case asyncProvider2.name:
                            expect(asyncProvider2.scanFileAsync).toHaveBeenCalled();
                            break;
                        case syncProvider3.name:
                            expect(syncProvider3.scanFile).toHaveBeenCalled();
                            break;
                        default:
                            expect(true).toBe(false);
                            break;
                    }
                }

            });

            it("should return results for 3 providers when 2 completes and 1 times out", async function () {
                var timeout         = prefs.get(CodeInspection._PREF_ASYNC_TIMEOUT),
                    asyncProvider1  = createAsyncCodeInspector("javascript async linter 1", failLintResult(), 200, true),
                    asyncProvider2  = createAsyncCodeInspector("javascript async linter 2", failLintResult(), timeout + 10, false),
                    syncProvider3   = createCodeInspector("javascript sync linter 3", failLintResult()),
                    result;
                CodeInspection.register("javascript", asyncProvider1);
                CodeInspection.register("javascript", asyncProvider2);
                CodeInspection.register("javascript", syncProvider3);

                var promise = CodeInspection.inspectFile(simpleJavascriptFileEntry);
                promise.done(function (r) {
                    result = r;
                });

                await awaitsForDone(promise, "file linting", timeout + 10);

                var i;
                expect(result.length).toEqual(3);

                for (i = 0; i < result.length; i++) {
                    switch (result[i].provider.name) {
                        case asyncProvider1.name:
                        case syncProvider3.name:
                            expect(result[i].result).toBeDefined();
                            expect(result[i].result).not.toBeNull();
                            break;
                        case asyncProvider2.name:
                            expect(result[i].result).toBeDefined();
                            expect(result[i].result.errors.length).toBe(1);
                            expect(result[i].result.errors[0].pos).toEqual({line: -1, col: 0});
                            expect(result[i].result.errors[0].message).toBe(StringUtils.format(Strings.LINTER_TIMED_OUT, "javascript async linter 2", prefs.get(CodeInspection._PREF_ASYNC_TIMEOUT)));
                            break;
                        default:
                            expect(true).toBe(false);
                            break;
                    }
                }
            });

            it("should support universal providers", function () {
                var codeInspector1 = createCodeInspector("javascript linter", successfulLintResult());
                var codeInspector2 = createCodeInspector("css linter", successfulLintResult());
                var codeInspector3 = createCodeInspector("universal linter", successfulLintResult());

                CodeInspection.register("javascript", codeInspector1);
                CodeInspection.register("css", codeInspector2);
                CodeInspection.register("*", codeInspector3);

                var providers = CodeInspection.getProvidersForPath("test.js");
                expect(providers.length).toBe(2);
                expect(providers[0]).toBe(codeInspector1);
                expect(providers[1]).toBe(codeInspector3);

                providers = CodeInspection.getProvidersForPath("test.css");
                expect(providers.length).toBe(2);
                expect(providers[0]).toBe(codeInspector2);
                expect(providers[1]).toBe(codeInspector3);

                providers = CodeInspection.getProvidersForPath("test.other");
                expect(providers.length).toBe(1);
                expect(providers[0]).toBe(codeInspector3);
            });

        });

        describe("Code Inspection UI", function () {
            beforeEach(function () {
                CodeInspection._unregisterAll();
                CodeInspection.toggleEnabled(true);
            });

            // Utility to create an async provider where the testcase can control when each async result resolves
            function makeAsyncLinter() {
                return {
                    name: "Test Async Linter",
                    scanFileAsync: function (text, fullPath) {
                        if (!this.futures[fullPath]) {
                            this.futures[fullPath] = [];
                            this.filesCalledOn.push(fullPath);
                        }

                        var result = new $.Deferred();
                        this.futures[fullPath].push(result);
                        return result.promise();
                    },
                    futures: {},      // map from full path to array of Deferreds (in call order)
                    filesCalledOn: [] // in order of first call for each path
                };
            }

            // Tooltip is panel title, plus an informational message when there are problems.
            function buildTooltip(title, count) {
                if (count === 0) {
                    return title;
                }
                return StringUtils.format(Strings.STATUSBAR_CODE_INSPECTION_TOOLTIP, title);
            }

            it("should run test linter when a JavaScript document opens and indicate errors in the panel", async function () {
                var codeInspector = createCodeInspector("javascript linter", failLintResult());
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file", 5000);

                expect($("#problems-panel").is(":visible")).toBe(true);
                var $statusBar = $("#status-inspection");
                expect($statusBar.is(":visible")).toBe(true);
            });

            it("should show errors underline under text in editor", async function () {
                let codeInspector = createCodeInspector("javascript linter", failLintResult());
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file", 5000);

                expect($("#problems-panel").is(":visible")).toBe(true);
                let marks = EditorManager.getActiveEditor().getAllMarks("codeInspector");
                expect(marks.length).toBe(1);
                expect(marks[0].className).toBe("editor-text-fragment-warn");
            });

            async function _testWarningIcon(lintResult, expectedClass) {
                let codeInspector = createCodeInspector("javascript linter", lintResult);
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file", 5000);

                expect($("#problems-panel").is(":visible")).toBe(true);
                let marks = EditorManager.getActiveEditor().getGutterMarker(1, CodeInspection.CODE_INSPECTION_GUTTER);
                expect(marks.title).toBe('\nSome errors here and there at column: 4');
                marks = $(marks);
                expect(marks.find('span').hasClass(expectedClass)).toBeTrue();
                return marks;
            }

            it("should show warning gutter icon on line in editor", async function () {
                await _testWarningIcon(failLintResult(), 'line-icon-problem_type_warning');
            });

            it("should show fix icon in gutter for warning on line in editor", async function () {
                const marks = await _testWarningIcon(failLintResult(true), 'line-icon-problem_type_warning');
                expect(marks.find('span').hasClass('fa-wrench')).toBeTrue();
                const $problemLineInPanel = CodeInspection.scrollToProblem(1);
                expect($problemLineInPanel.find("i").hasClass("fa-wrench")).toBeTrue();
            });

            it("should show fix icon in gutter for error on line in editor", async function () {
                const errorResult = failLintResult(true);
                errorResult.errors[0].type = CodeInspection.Type.ERROR;
                const marks = await _testWarningIcon(errorResult, 'line-icon-problem_type_error');
                expect(marks.find('span').hasClass('fa-wrench')).toBeTrue();
                const $problemLineInPanel = CodeInspection.scrollToProblem(1);
                expect($problemLineInPanel.find("i").hasClass("fa-wrench")).toBeTrue();
            });

            it("should show fix icon in gutter and panel for info on line in editor", async function () {
                const errorResult = failLintResult(true);
                errorResult.errors[0].type = CodeInspection.Type.META;
                const marks = await _testWarningIcon(errorResult, 'line-icon-problem_type_info');
                expect(marks.find('span').hasClass('fa-wrench')).toBeTrue();
                const $problemLineInPanel = CodeInspection.scrollToProblem(1);
                expect($problemLineInPanel.find("i").hasClass("fa-wrench")).toBeTrue();
            });

            it("should not show codeinspection gutter on unsupported languages", async function () {
                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["no-gutters.md"]), "open test file", 5000);

                expect($("#problems-panel").is(":visible")).toBe(false);
                let gutters = EditorManager.getActiveEditor()._codeMirror.options.gutters;
                expect(gutters.includes(CodeInspection.CODE_INSPECTION_GUTTER)).toBeFalse();
            });

            it("should show info gutter icon on line in editor", async function () {
                let codeInspector1 = createCodeInspector("javascript linter 1", {
                    errors: [
                        {
                            pos: { line: 1, ch: 1 },
                            message: "Some errors here and there",
                            type: CodeInspection.Type.META
                        }
                    ]
                });
                CodeInspection.register("javascript", codeInspector1);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                expect($("#problems-panel").is(":visible")).toBe(true);
                let marks = $(EditorManager.getActiveEditor()
                    .getGutterMarker(1, CodeInspection.CODE_INSPECTION_GUTTER));
                expect(marks.find('span').hasClass('line-icon-problem_type_info')).toBeTrue();
            });

            function _hasClass(marks, className) {
                let errorFound = false;
                for(let mark of marks) {
                    if(mark.className === className){
                        errorFound = true;
                        break;
                    }
                }
                return errorFound;
            }

            async function _verifyMixOfErrors(chw, che, chm, numMarksExpected = 1) {
                let codeInspector1 = createCodeInspector("javascript linter 1", {
                    errors: [
                        {
                            pos: { line: 1, ch: chw },
                            message: "Some warnings here and there",
                            type: CodeInspection.Type.WARNING
                        }, {
                            pos: { line: 1, ch: che },
                            message: "Some errors here and there",
                            type: CodeInspection.Type.ERROR
                        }, {
                            pos: { line: 1, ch: chm },
                            message: "Some meta here and there",
                            type: CodeInspection.Type.META
                        }
                    ]
                });
                CodeInspection.register("javascript", codeInspector1);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                expect($("#problems-panel").is(":visible")).toBe(true);
                let marks = EditorManager.getActiveEditor().getAllMarks("codeInspector");
                expect(marks.length).toBe(numMarksExpected);

                expect(_hasClass(marks, "editor-text-fragment-error")).toBe(true);
            }

            it("should have errors if warnings and info present in the same location", async function () {
                await _verifyMixOfErrors(1, 2, 3, 3);
            });

            it("should show errors icon only in gutter if warn and info also present on line", async function () {
                await _verifyMixOfErrors(1, 2, 3, 3);

                let marks = $(EditorManager.getActiveEditor().getGutterMarker(1, CodeInspection.CODE_INSPECTION_GUTTER));
                expect(marks.find('span').hasClass('line-icon-problem_type_error')).toBeTrue();
            });

            it("should show errors, warning or info underline under text in editor appropriately", async function () {
                await _verifyMixOfErrors(1, 2, 10, 3);

                let marks = EditorManager.getActiveEditor().getAllMarks("codeInspector");
                expect(_hasClass(marks, "editor-text-fragment-error")).toBe(true);
                expect(_hasClass(marks, "editor-text-fragment-info")).toBe(true);
            });

            it("should ignore async results from previous file", async function () {
                CodeInspection.toggleEnabled(false);

                var asyncProvider = makeAsyncLinter();
                CodeInspection.register("javascript", asyncProvider);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["no-errors.js", "errors.js"]), "open test files");

                var errorsJS   = SpecRunnerUtils.makeAbsolute("errors.js"),
                    noErrorsJS = SpecRunnerUtils.makeAbsolute("no-errors.js");

                // Start linting the first file
                CodeInspection.toggleEnabled(true);
                expect(asyncProvider.filesCalledOn).toEqual([errorsJS]);

                // Close that file, switching to the 2nd one
                await awaitsForDone(CommandManager.execute(Commands.FILE_CLOSE));

                // Verify that we started linting the 2nd file
                expect(DocumentManager.getCurrentDocument().file.fullPath).toBe(noErrorsJS);
                expect(asyncProvider.filesCalledOn).toEqual([errorsJS, noErrorsJS]);

                // Finish old (stale) linting session - verify results not shown
                asyncProvider.futures[errorsJS][0].resolve(failLintResult());
                expect($("#problems-panel").is(":visible")).toBe(false);

                // Finish new (current) linting session
                asyncProvider.futures[noErrorsJS][0].resolve(successfulLintResult());
                expect($("#problems-panel").is(":visible")).toBe(false);
            });

            it("should ignore async results from previous run in same file - finishing in order", async function () {
                CodeInspection.toggleEnabled(false);

                var asyncProvider = makeAsyncLinter();
                CodeInspection.register("javascript", asyncProvider);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["no-errors.js"]), "open test files");

                var noErrorsJS = SpecRunnerUtils.makeAbsolute("no-errors.js");

                // Start linting the file
                CodeInspection.toggleEnabled(true);
                expect(asyncProvider.filesCalledOn).toEqual([noErrorsJS]);

                // "Modify" the file
                DocumentManager.trigger("documentSaved", DocumentManager.getCurrentDocument());
                expect(asyncProvider.futures[noErrorsJS].length).toBe(2);

                // Finish old (stale) linting session - verify results not shown
                asyncProvider.futures[noErrorsJS][0].resolve(failLintResult());
                await awaits(100);
                expect($("#problems-panel").is(":visible")).toBe(false);

                // Finish new (current) linting session - verify results are shown
                asyncProvider.futures[noErrorsJS][1].resolve(failLintResult());
                await awaits(100);
                expect($("#problems-panel").is(":visible")).toBe(true);
            });

            it("should ignore async results from previous run in same file - finishing reverse order", async function () {
                CodeInspection.toggleEnabled(false);

                var asyncProvider = makeAsyncLinter();
                CodeInspection.register("javascript", asyncProvider);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["no-errors.js"]), "open test files");

                var noErrorsJS = SpecRunnerUtils.makeAbsolute("no-errors.js");

                // Start linting the file
                CodeInspection.toggleEnabled(true);
                expect(asyncProvider.filesCalledOn).toEqual([noErrorsJS]);

                // "Modify" the file
                DocumentManager.trigger("documentSaved", DocumentManager.getCurrentDocument());
                expect(asyncProvider.futures[noErrorsJS].length).toBe(2);

                // Finish new (current) linting session - verify results are shown
                asyncProvider.futures[noErrorsJS][1].resolve(failLintResult());
                await awaits(100);
                expect($("#problems-panel").is(":visible")).toBe(true);

                // Finish old (stale) linting session - verify results don't replace current results
                asyncProvider.futures[noErrorsJS][0].resolve(successfulLintResult());
                await awaits(100);
                expect($("#problems-panel").is(":visible")).toBe(true);
            });

            it("should ignore async results after linting disabled", async function () {
                CodeInspection.toggleEnabled(false);

                var asyncProvider = makeAsyncLinter();
                CodeInspection.register("javascript", asyncProvider);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["no-errors.js"]), "open test files");

                var noErrorsJS = SpecRunnerUtils.makeAbsolute("no-errors.js");

                // Start linting the file
                CodeInspection.toggleEnabled(true);
                expect(asyncProvider.filesCalledOn).toEqual([noErrorsJS]);

                // Disable linting
                CodeInspection.toggleEnabled(false);

                // Finish old (stale) linting session - verify results not shown
                asyncProvider.futures[noErrorsJS][0].resolve(failLintResult());
                expect($("#problems-panel").is(":visible")).toBe(false);
            });

            it("should show problems panel after too many errors", async function () {
                var lintResult = {
                    errors: [
                        {
                            pos: { line: 1, ch: 3 },
                            message: "Some errors here and there",
                            type: CodeInspection.Type.WARNING
                        },
                        {
                            pos: { line: 1, ch: 5 },
                            message: "Stopping. (33% scanned).",
                            type: CodeInspection.Type.META
                        }
                    ],
                    aborted: true
                };

                var codeInspector = createCodeInspector("javascript linter", lintResult);
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file", 5000);

                expect($("#problems-panel").is(":visible")).toBe(true);
                var $statusBar = $("#status-inspection");
                expect($statusBar.is(":visible")).toBe(true);

                var tooltip = $statusBar.attr("title");
                // tooltip will contain + in the title if the inspection was aborted
                expect(tooltip.lastIndexOf("+")).not.toBe(-1);
            });

            it("should not run test linter when a JavaScript document opens and linting is disabled", async function () {
                CodeInspection.toggleEnabled(false);

                var codeInspector = createCodeInspector("javascript linter", failLintResult());
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file", 5000);

                expect(codeInspector.scanFile).not.toHaveBeenCalled();
                expect($("#problems-panel").is(":visible")).toBe(false);
                var $statusBar = $("#status-inspection");
                expect($statusBar.is(":visible")).toBe(true);

                CodeInspection.toggleEnabled(true);
            });

            it("should not show the problems panel when there is no linting error - empty errors array", async function () {
                var codeInspector = createCodeInspector("javascript linter", {errors: []});
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file", 5000);

                expect($("#problems-panel").is(":visible")).toBe(false);
                var $statusBar = $("#status-inspection");
                expect($statusBar.is(":visible")).toBe(true);
            });

            it("should not show the problems panel when there is no linting error - null result", async function () {
                var codeInspector = createCodeInspector("javascript linter", null);
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file", 5000);

                expect($("#problems-panel").is(":visible")).toBe(false);
                var $statusBar = $("#status-inspection");
                expect($statusBar.is(":visible")).toBe(true);
            });

            it("should display two expanded, collapsible sections in the errors panel when two linters have errors", async function () {
                var codeInspector1 = createCodeInspector("javascript linter 1", failLintResult());
                var codeInspector2 = createCodeInspector("javascript linter 2", failLintResult());
                CodeInspection.register("javascript", codeInspector1);
                CodeInspection.register("javascript", codeInspector2);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file", 5000);

                var $inspectorSections = $(".inspector-section");
                expect($inspectorSections.length).toEqual(2);
                expect($inspectorSections[0].innerHTML.lastIndexOf("javascript linter 1 (1)")).not.toBe(-1);
                expect($inspectorSections[1].innerHTML.lastIndexOf("javascript linter 2 (1)")).not.toBe(-1);

                var $expandedInspectorSections = $inspectorSections.find(".expanded");
                expect($expandedInspectorSections.length).toEqual(2);
            });

            async function _validateNoHeader(withFix) {
                var codeInspector1 = createCodeInspector("javascript linter 1", failLintResult(withFix)),
                    codeInspector2 = createCodeInspector("javascript linter 2", {errors: []}),  // 1st way of reporting 0 errors
                    codeInspector3 = createCodeInspector("javascript linter 3", null);          // 2nd way of reporting 0 errors
                CodeInspection.register("javascript", codeInspector1);
                CodeInspection.register("javascript", codeInspector2);
                CodeInspection.register("javascript", codeInspector3);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file", 5000);

                expect($("#problems-panel").is(":visible")).toBe(true);
                expect($(".inspector-section").is(":visible")).toBeFalsy();
            }

            it("should display no header section when only one linter has errors", async function () {
                await _validateNoHeader();
            });

            it("should display no header section when only one linter has errors with fixes", async function () {
                await _validateNoHeader(true);
            });

            it("should only display header sections for linters with errors", async function () {
                var codeInspector1 = createCodeInspector("javascript linter 1", failLintResult()),
                    codeInspector2 = createCodeInspector("javascript linter 2", {errors: []}),  // 1st way of reporting 0 errors
                    codeInspector3 = createCodeInspector("javascript linter 3", null),          // 2nd way of reporting 0 errors
                    codeInspector4 = createCodeInspector("javascript linter 4", failLintResult());
                CodeInspection.register("javascript", codeInspector1);
                CodeInspection.register("javascript", codeInspector2);
                CodeInspection.register("javascript", codeInspector3);
                CodeInspection.register("javascript", codeInspector4);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file", 5000);

                expect($("#problems-panel").is(":visible")).toBe(true);

                var $inspectorSections = $(".inspector-section");
                expect($inspectorSections.length).toEqual(2);
                expect($inspectorSections[0].innerHTML.indexOf("javascript linter 1 (1)")).not.toBe(-1);
                expect($inspectorSections[1].innerHTML.indexOf("javascript linter 4 (1)")).not.toBe(-1);
            });

            it("status icon should toggle Errors panel when errors present", async function () {
                var codeInspector = createCodeInspector("javascript linter", failLintResult());
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                toggleJSLintResults(false);
                toggleJSLintResults(true);
            });

            it("status icon should not toggle Errors panel when no errors present", async function () {
                var codeInspector = createCodeInspector("javascript linter", successfulLintResult());
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["no-errors.js"]), "open test file");

                toggleJSLintResults(false);
                toggleJSLintResults(false);
            });

            it("should show the error count and the name of the linter in the panel title for one error", async function () {
                var codeInspector = createCodeInspector("JavaScript Linter", failLintResult());
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                var $problemPanelTitle = $("#problems-panel .title").text();
                expect($problemPanelTitle).toBe(StringUtils.format(Strings.SINGLE_ERROR, "JavaScript Linter", "errors.js"));

                var $statusBar = $("#status-inspection");
                expect($statusBar.is(":visible")).toBe(true);

                var tooltip = $statusBar.attr("title");
                var expectedTooltip = buildTooltip(StringUtils.format(Strings.SINGLE_ERROR, "JavaScript Linter", "errors.js"), 1);
                expect(tooltip).toBe(expectedTooltip);
            });

            it("should show the error count and the name of the linter in the panel title for one error", async function () {
                var codeInspector = createCodeInspector("JavaScript Linter", failLintResult(true));
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                var $problemPanelTitle = $("#problems-panel .title").text();
                expect($problemPanelTitle).toBe(StringUtils.format(Strings.SINGLE_ERROR_FIXABLE, "JavaScript Linter", 1, "errors.js"));

                var $statusBar = $("#status-inspection");
                expect($statusBar.is(":visible")).toBe(true);

                var tooltip = $statusBar.attr("title");
                var expectedTooltip = buildTooltip(StringUtils.format(Strings.SINGLE_ERROR_FIXABLE, "JavaScript Linter", 1, "errors.js"), 1);
                expect(tooltip).toBe(expectedTooltip);
            });

            it("should show the error count and the name of the linter in the panel title and tooltip for multiple errors", async function () {
                var lintResult = {
                    errors: [
                        {
                            pos: { line: 1, ch: 3 },
                            message: "Some errors here and there",
                            type: CodeInspection.Type.WARNING
                        },
                        {
                            pos: { line: 1, ch: 5 },
                            message: "Some errors there and there and over there",
                            type: CodeInspection.Type.WARNING
                        }
                    ]
                };

                var codeInspector = createCodeInspector("JavaScript Linter", lintResult);
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                var $problemPanelTitle = $("#problems-panel .title").text();
                expect($problemPanelTitle).toBe(StringUtils.format(Strings.MULTIPLE_ERRORS, 2, "JavaScript Linter", "errors.js"));

                var $statusBar = $("#status-inspection");
                expect($statusBar.is(":visible")).toBe(true);

                var tooltip = $statusBar.attr("title");
                var expectedTooltip = buildTooltip(StringUtils.format(Strings.MULTIPLE_ERRORS, 2, "JavaScript Linter", "errors.js"), 2);
                expect(tooltip).toBe(expectedTooltip);
            });

            it("should show the error count and the name of the linter in the panel title and tooltip for multiple errors with fixes", async function () {
                var lintResult = {
                    errors: [
                        {
                            pos: { line: 1, ch: 3 },
                            message: "Some errors here and there",
                            type: CodeInspection.Type.WARNING,
                            fix: {
                                replaceText: "",
                                rangeOffset: {
                                    start: 0,
                                    end: 1
                                }
                            }
                        },
                        {
                            pos: { line: 1, ch: 5 },
                            message: "Some errors there and there and over there",
                            type: CodeInspection.Type.WARNING,
                            fix: {
                                replaceText: "",
                                rangeOffset: {
                                    start: 0,
                                    end: 1
                                }
                            }
                        }
                    ]
                };

                var codeInspector = createCodeInspector("JavaScript Linter", lintResult);
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                var $problemPanelTitle = $("#problems-panel .title").text();
                expect($problemPanelTitle).toBe(StringUtils.format(Strings.MULTIPLE_ERRORS_FIXABLE, 2, "JavaScript Linter", 2, "errors.js"));

                var $statusBar = $("#status-inspection");
                expect($statusBar.is(":visible")).toBe(true);

                var tooltip = $statusBar.attr("title");
                var expectedTooltip = buildTooltip(StringUtils.format(Strings.MULTIPLE_ERRORS_FIXABLE, 2, "JavaScript Linter", 2, "errors.js"), 2);
                expect(tooltip).toBe(expectedTooltip);
            });

            it("should show the generic panel title if more than one inspector reported problems", async function () {
                var lintResult = failLintResult();

                var codeInspector1 = createCodeInspector("JavaScript Linter1", lintResult);
                CodeInspection.register("javascript", codeInspector1);
                var codeInspector2 = createCodeInspector("JavaScript Linter2", lintResult);
                CodeInspection.register("javascript", codeInspector2);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                var $problemPanelTitle = $("#problems-panel .title").text();
                expect($problemPanelTitle).toBe(StringUtils.format(Strings.ERRORS_PANEL_TITLE_MULTIPLE, 2, "errors.js"));

                var $statusBar = $("#status-inspection");
                expect($statusBar.is(":visible")).toBe(true);

                var tooltip = $statusBar.attr("title");
                // tooltip will contain + in the title if the inspection was aborted
                var expectedTooltip = buildTooltip(StringUtils.format(Strings.ERRORS_PANEL_TITLE_MULTIPLE, 2, "errors.js"), 2);
                expect(tooltip).toBe(expectedTooltip);
            });

            it("should show the generic panel title if more than one inspector reported problems with fixes", async function () {
                var lintResult = failLintResult(true);

                var codeInspector1 = createCodeInspector("JavaScript Linter1", lintResult);
                CodeInspection.register("javascript", codeInspector1);
                var codeInspector2 = createCodeInspector("JavaScript Linter2", lintResult);
                CodeInspection.register("javascript", codeInspector2);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                var $problemPanelTitle = $("#problems-panel .title").text();
                expect($problemPanelTitle).toBe(StringUtils.format(Strings.ERRORS_PANEL_TITLE_MULTIPLE_FIXABLE, 2, 2, "errors.js"));

                var $statusBar = $("#status-inspection");
                expect($statusBar.is(":visible")).toBe(true);

                var tooltip = $statusBar.attr("title");
                // tooltip will contain + in the title if the inspection was aborted
                var expectedTooltip = buildTooltip(StringUtils.format(Strings.ERRORS_PANEL_TITLE_MULTIPLE_FIXABLE, 2, 2,"errors.js"), 2);
                expect(tooltip).toBe(expectedTooltip);
            });

            it("should show no problems tooltip in status bar for multiple inspectors", async function () {
                var codeInspector = createCodeInspector("JavaScript Linter1", successfulLintResult());
                CodeInspection.register("javascript", codeInspector);
                codeInspector = createCodeInspector("JavaScript Linter2", successfulLintResult());
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                var $statusBar = $("#status-inspection");
                expect($statusBar.is(":visible")).toBe(true);

                var tooltip = $statusBar.attr("title");
                var expectedTooltip = buildTooltip(Strings.NO_ERRORS_MULTIPLE_PROVIDER, 0);
                expect(tooltip).toBe(expectedTooltip);
            });

            it("should show no problems tooltip in status bar for 1 inspector", async function () {
                var codeInspector = createCodeInspector("JavaScript Linter1", successfulLintResult());
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                var $statusBar = $("#status-inspection");
                expect($statusBar.is(":visible")).toBe(true);

                var tooltip = $statusBar.attr("title");
                var expectedTooltip = buildTooltip(StringUtils.format(Strings.NO_ERRORS, "JavaScript Linter1"), 0);
                expect(tooltip).toBe(expectedTooltip);
            });

            it("should Go to First Error with errors from only one provider", async function () {
                var codeInspector = createCodeInspector("javascript linter", failLintResult());
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                CommandManager.execute(Commands.NAVIGATE_GOTO_FIRST_PROBLEM);
                expect(fixPos(EditorManager.getActiveEditor().getCursorPos())).toEqual(fixPos({line: 1, ch: 3}));
            });

            it("should be able to copy problem message", async function () {
                const codeInspector = createCodeInspector("javascript linter", failLintResult());
                CodeInspection.register("javascript", codeInspector);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                const $problemLine = CodeInspection.scrollToProblem(1);
                let copiedVal;
                testWindow.Phoenix.app.copyToClipboard = function (val) {
                    copiedVal = val;
                };
                const $copyBtnElems = $problemLine.find(".ph-copy-problem");
                for(let i=0; i<$copyBtnElems.length; i++) {
                    copiedVal = null;
                    $copyBtnElems[i].click();
                    expect(copiedVal).toBe("Some errors here and there");
                }
            });

            it("should Go to First Error with errors from two providers", async function () {
                var codeInspector1 = createCodeInspector("javascript linter 1", {
                    errors: [
                        {
                            pos: { line: 1, ch: 3 },
                            message: "Some errors here and there",
                            type: CodeInspection.Type.WARNING
                        }
                    ]
                });
                var codeInspector2 = createCodeInspector("javascript linter 2", {
                    errors: [
                        {
                            pos: { line: 0, ch: 2 },
                            message: "Different error",
                            type: CodeInspection.Type.WARNING
                        }
                    ]
                });
                CodeInspection.register("javascript", codeInspector1);
                CodeInspection.register("javascript", codeInspector2);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                CommandManager.execute(Commands.NAVIGATE_GOTO_FIRST_PROBLEM);
                // 'first' error is in order of linter registration, not in line number order
                expect(fixPos(EditorManager.getActiveEditor().getCursorPos())).toEqual(fixPos({line: 1, ch: 3}));
            });

            it("should not show providers that returns isIgnored", async function () {
                var codeInspector1 = createCodeInspector("javascript linter x", {
                    isIgnored: true
                });
                const linterName = "javascript linter y";
                var codeInspector2 = createCodeInspector(linterName, {
                    errors: [
                        {
                            pos: { line: 0, ch: 2 },
                            message: "Different error",
                            type: CodeInspection.Type.WARNING
                        }
                    ]
                });
                CodeInspection.register("javascript", codeInspector1);
                CodeInspection.register("javascript", codeInspector2);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                const $problemPanelTitle = $("#problems-panel .title").text();
                expect($problemPanelTitle).toBe(StringUtils.format(Strings.SINGLE_ERROR, linterName, "errors.js"));

                var $statusBar = $("#status-inspection");
                expect($statusBar.is(":visible")).toBe(true);
            });

            it("should not show no error if all isIgnored", async function () {
                var codeInspector1 = createCodeInspector("javascript linter x", {
                    isIgnored: true
                });
                const linterName = "javascript linter y";
                var codeInspector2 = createCodeInspector(linterName, {
                    isIgnored: true
                });
                CodeInspection.register("javascript", codeInspector1);
                CodeInspection.register("javascript", codeInspector2);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                expect($("#status-inspection").hasClass("inspection-disabled")).toBeTrue();
            });

            it("should handle missing or negative line numbers gracefully (https://github.com/adobe/brackets/issues/6441)", async function () {
                var codeInspector1 = createCodeInspector("NoLineNumberLinter", {
                    errors: [
                        {
                            pos: { line: -1, ch: 0 },
                            message: "Some errors here and there",
                            type: CodeInspection.Type.WARNING
                        }
                    ]
                });

                var codeInspector2 = createCodeInspector("NoLineNumberLinter2", {
                    errors: [
                        {
                            pos: { line: "all", ch: 0 },
                            message: "Some errors here and there",
                            type: CodeInspection.Type.WARNING
                        }
                    ]
                });
                CodeInspection.register("javascript", codeInspector1);
                CodeInspection.register("javascript", codeInspector2);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                await awaits(100);
                var $problemPanelTitle = $("#problems-panel .title").text();
                expect($problemPanelTitle).toBe(StringUtils.format(Strings.ERRORS_PANEL_TITLE_MULTIPLE, 2, "errors.js"));

                var $statusBar = $("#status-inspection");
                expect($statusBar.is(":visible")).toBe(true);

                var tooltip = $statusBar.attr("title");
                var expectedTooltip = buildTooltip(StringUtils.format(Strings.ERRORS_PANEL_TITLE_MULTIPLE, 2, "errors.js"), 2);
                expect(tooltip).toBe(expectedTooltip);
            });

            it("should report an async linter which has timed out", async function () {
                var codeInspectorToTimeout = createAsyncCodeInspector("SlowAsyncLinter", {
                    errors: [
                        {
                            pos: { line: 1, ch: 0 },
                            message: "SlowAsyncLinter was here",
                            type: CodeInspection.Type.WARNING
                        },
                        {
                            pos: { line: 2, ch: 0 },
                            message: "SlowAsyncLinter was here as well",
                            type: CodeInspection.Type.WARNING
                        }
                    ]
                }, prefs.get(CodeInspection._PREF_ASYNC_TIMEOUT) + 10, false);

                CodeInspection.register("javascript", codeInspectorToTimeout);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                await awaits(prefs.get(CodeInspection._PREF_ASYNC_TIMEOUT) + 20);

                var $problemsPanel = $("#problems-panel");
                expect($problemsPanel.is(":visible")).toBe(true);

                var $problemsPanelTitle = $("#problems-panel .title").text();
                expect($problemsPanelTitle).toBe(StringUtils.format(Strings.SINGLE_ERROR, "SlowAsyncLinter", "errors.js"));

                var $problemsReported = $("#problems-panel .bottom-panel-table .line-text");
                expect($problemsReported.length).toBe(1);
                expect($problemsReported.text())
                    .toBe(
                        StringUtils.format(Strings.LINTER_TIMED_OUT, "SlowAsyncLinter", prefs.get(CodeInspection._PREF_ASYNC_TIMEOUT))
                    );
            });

            it("should report an async linter which rejects", async function () {
                var errorMessage = "I'm full of bugs on purpose",
                    providerName = "Buggy Async Linter",
                    buggyAsyncProvider = {
                        name: providerName,
                        scanFileAsync: function () {
                            var deferred = new $.Deferred();
                            deferred.reject(errorMessage);
                            return deferred.promise();
                        }
                    };

                CodeInspection.register("javascript", buggyAsyncProvider);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                var $problemsPanel = $("#problems-panel");
                expect($problemsPanel.is(":visible")).toBe(true);

                var $problemsPanelTitle = $("#problems-panel .title").text();
                expect($problemsPanelTitle).toBe(StringUtils.format(Strings.SINGLE_ERROR, providerName, "errors.js"));

                var $problemsReported = $("#problems-panel .bottom-panel-table .line-text");
                expect($problemsReported.length).toBe(1);
                expect($problemsReported.text())
                    .toBe(StringUtils.format(Strings.LINTER_FAILED, providerName, errorMessage));
            });

            it("should report a sync linter which throws an exception", async function () {
                var errorMessage = "I'm synchronous, but still full of bugs",
                    providerName = "Buggy Sync Linter",
                    buggySyncProvider = {
                        name: providerName,
                        scanFile: function () {
                            throw new Error(errorMessage);
                        }
                    };

                CodeInspection.register("javascript", buggySyncProvider);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                var $problemsPanel = $("#problems-panel");
                expect($problemsPanel.is(":visible")).toBe(true);

                var $problemsPanelTitle = $("#problems-panel .title").text();
                expect($problemsPanelTitle).toBe(StringUtils.format(Strings.SINGLE_ERROR, providerName, "errors.js"));

                var $problemsReported = $("#problems-panel .bottom-panel-table .line-text");
                expect($problemsReported.length).toBe(1);
                expect($problemsReported.text())
                    .toBe(StringUtils.format(Strings.LINTER_FAILED, providerName, new Error(errorMessage)));
            });

            it("should keep the order as per registration", async function () {
                var asyncProvider1 = createAsyncCodeInspector("javascript async linter 1", failLintResult(), 400, true),
                    asyncProvider2 = createAsyncCodeInspector("javascript async linter 2", failLintResult(), 300, false),
                    syncProvider3 = createCodeInspector("javascript sync linter 3", failLintResult()),
                    registrationOrder = [asyncProvider1, asyncProvider2, syncProvider3],
                    i,
                    expected = "";

                for (i = 0; i < registrationOrder.length; i++) {
                    CodeInspection.register("javascript", registrationOrder[i]);
                    expected += registrationOrder[i].name + " " + "(1) ";
                }

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["errors.js"]), "open test file");

                await awaits(410);

                expect($("#problems-panel .inspector-section").text().trim().replace(/\s+/g, " "))
                    // actual string expected:
                    //.toBe("javascript async linter 1 (1) javascript async linter 2 (1) javascript sync linter 3 (1)");
                    .toBe(expected.trim());
            });
        });

        describe("Code Inspector Registration", function () {
            beforeEach(function () {
                CodeInspection._unregisterAll();
            });

            it("should call inspector 1 and inspector 2", async function () {
                var codeInspector1 = createCodeInspector("javascript inspector 1", successfulLintResult());
                CodeInspection.register("javascript", codeInspector1);
                var codeInspector2 = createCodeInspector("javascript inspector 2", successfulLintResult());
                CodeInspection.register("javascript", codeInspector2);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["no-errors.js"]), "open test file", 5000);

                expect(codeInspector1.scanFile).toHaveBeenCalled();
                expect(codeInspector2.scanFile).toHaveBeenCalled();
            });

            it("should keep inspector 1 because the name of inspector 2 is different", async function () {
                var codeInspector1 = createCodeInspector("javascript inspector 1", successfulLintResult());
                CodeInspection.register("javascript", codeInspector1);
                var codeInspector2 = createCodeInspector("javascript inspector 2", successfulLintResult());
                CodeInspection.register("javascript", codeInspector2, true);

                await awaitsForDone(SpecRunnerUtils.openProjectFiles(["no-errors.js"]), "open test file", 5000);

                expect(codeInspector1.scanFile).toHaveBeenCalled();
                expect(codeInspector2.scanFile).toHaveBeenCalled();
            });
        });
    });
});
