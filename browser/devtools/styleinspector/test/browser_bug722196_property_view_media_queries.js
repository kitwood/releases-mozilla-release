/* vim: set ts=2 et sw=2 tw=80: */
/* Any copyright is dedicated to the Public Domain.
 http://creativecommons.org/publicdomain/zero/1.0/ */

// Tests that we correctly display appropriate media query titles in the
// property view.

let doc;
let stylePanel;

const TEST_URI = "http://example.com/browser/browser/devtools/styleinspector/" +
  "test/browser_bug722196_identify_media_queries.html";

function test()
{
  waitForExplicitFinish();
  addTab(TEST_URI);
  browser.addEventListener("load", docLoaded, true);
}

function docLoaded()
{
  browser.removeEventListener("load", docLoaded, true);
  doc = content.document;
  stylePanel = new ComputedViewPanel(window);
  stylePanel.createPanel(doc.body, checkSheets);
}

function checkSheets()
{
  var div = doc.querySelector("div");
  ok(div, "captain, we have the div");

  stylePanel.selectNode(div);

  let cssLogic = stylePanel.cssLogic;
  cssLogic.processMatchedSelectors();

  let _strings = Services.strings
    .createBundle("chrome://browser/locale/devtools/styleinspector.properties");

  let inline = _strings.GetStringFromName("rule.sourceInline");

  let source1 = inline + ":8";
  let source2 = inline + ":15 @media screen and (min-width: 1px)";
  is(cssLogic._matchedRules[0][0].source, source1,
    "rule.source gives correct output for rule 1");
  is(cssLogic._matchedRules[1][0].source, source2,
    "rule.source gives correct output for rule 2");

  stylePanel.destroy();
  finishUp();
}

function finishUp()
{
  doc = null;
  gBrowser.removeCurrentTab();
  finish();
}
