(() => {
 const stop = new Set('the a an and or of to in on for with from by as at is are was were this that it its new news today live latest says said after before over under how what why video update les des une dans pour avec sur est qui le la de du die der das und von mit ein eine el los las del que en por un una di il lo gli per con da et'.split(' '));
 const civic = /전쟁|선거|정부|국회|지진|홍수|기후|사망|경제|금리|노동|파업|의료|전력|핵|war\b|election|government|earthquake|flood|climate|killed|inflation|economy|strike|health|energy|nuclear|guerre|élection|gouvernement|séisme|inondation|krieg|wahl|regierung|guerra|elecciones|terremoto|governo|economia|政|選挙|地震|洪水|经济|經濟|战争|戦争|حرب|انتخاب|زلزال|حكومة|सरकार|चुनाव|भूकंप/iu;
 globalThis.rankHeadlines = articles => {
  const words = articles.map(a => {
   const segmenter = new Intl.Segmenter(a.lang || 'en',{granularity:'word'});
   return [...new Set([...segmenter.segment(a.title.normalize('NFKC').toLocaleLowerCase())]
    .filter(s => s.isWordLike && s.segment.length >= 2 && !stop.has(s.segment) && !/^\d+$/.test(s.segment)).map(s => s.segment))];
  });
  const coverage = new Map();
  words.forEach((tokens,i) => tokens.forEach(word => {
   if (!coverage.has(word)) coverage.set(word,new Set());
   coverage.get(word).add(articles[i].source);
  }));
  return new Map(articles.map((a,i) => {
   const mentions = words[i].map(w => Math.min(10,coverage.get(w).size)).sort((a,b) => b-a).slice(0,3);
   const score = mentions.reduce((n,x) => n+x,0) + (civic.test(a.title) ? 12 : 0)
    + (a.topNews ? 15 : 0) + (Number.isFinite(a.feedRank) ? 5/(a.feedRank+1) : 0);
   return [a.id,score];
  }));
 };
})();
