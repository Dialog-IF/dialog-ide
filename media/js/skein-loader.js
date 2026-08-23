// Single entry point for the Skein page's two module scripts, replacing separate <script
// type="module"> tags for each - ES modules guarantee sibling static imports with no dependency
// edge between them evaluate in declaration order, so main.js is guaranteed to finish setting
// window.sk before datastar.js runs and starts dereferencing it from data-init="sk...()"
// attributes already in the page (e.g. sk.initTreeGraph()). Relying on <script> tag order alone
// worked (both are deferred, and deferred scripts execute in document order) but was an implicit
// contract nothing in the markup made obvious - a future reordering could silently reintroduce
// the "sk is not defined" race.
import './main.js';
import './datastar.js';
