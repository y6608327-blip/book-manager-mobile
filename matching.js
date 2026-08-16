/**
 * 照合ロジック(純粋関数のみ・DOM/localStorage/fetchに依存しない)
 *
 * ブラウザ(<script>タグ経由でwindow.BookMatchingとして)とNode.js(require経由)の
 * 両方から使えるようにし、ロジックの正しさを自動テストできるようにしてある。
 * (tests/test_matching.js 参照)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BookMatching = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {

  function norm(s) {
    return (s || "").toString();
  }

  /** ISBNの完全一致で1件探す。見つからなければnull。 */
  function findByIsbn(items, isbn) {
    if (!isbn) return null;
    return items.find(function (it) { return it.isbn === isbn; }) || null;
  }

  /** 指定シリーズの所持巻数一覧(昇順)。 */
  function seriesVolumes(items, seriesName) {
    if (!seriesName) return [];
    return items
      .filter(function (it) { return it.series_name === seriesName && it.volume; })
      .map(function (it) { return it.volume; })
      .sort(function (a, b) { return a - b; });
  }

  /** タイトル/サークル名の部分一致検索(大文字小文字を無視)。 */
  function searchText(items, query, limit) {
    limit = limit || 20;
    var q = norm(query).toLowerCase();
    if (!q) return [];
    return items
      .filter(function (it) {
        var title = norm(it.title).toLowerCase();
        var circle = norm(it.circle_name).toLowerCase();
        return title.indexOf(q) !== -1 || circle.indexOf(q) !== -1;
      })
      .slice(0, limit);
  }

  return { findByIsbn: findByIsbn, seriesVolumes: seriesVolumes, searchText: searchText };
});
