/** URL-driven sitemap group selection for Tayfun's visual SEO page browser. */
export declare const PRODUCT_GROUPS: readonly string[];
export declare const OTHER_GROUPS: readonly string[];
export declare function pageGroupFor(url:string):string;
export declare function groupOrder(groups:Iterable<string>):string[];
