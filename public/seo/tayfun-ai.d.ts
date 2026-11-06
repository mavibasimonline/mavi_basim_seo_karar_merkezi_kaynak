/** Browser-only product-scoped AI transfer; does not invoke an external AI service. */
export type TayfunAiProduct={id:string;name:string;category?:string|null;canonical_url:string;urls?:string[]};
export type TayfunAiHistory={save_month:string;versions:Array<Record<string,any>>;tracked_keywords:string[];oldest_recorded_at:string|null;latest_revision_id:string|null};
export type TayfunKeywordTrend={query:string;current_clicks:number|null;previous_clicks:number|null;current_impressions:number|null;previous_impressions:number|null;delta_clicks:number|null;signal:string;saved_decision:string|null};
export declare function buildProductAiHandoff(input:{product:TayfunAiProduct;month:string;device:string;report:any;previous:any;history:TayfunAiHistory;observed:any}):string;
export declare function productKeywordTracking(input:{product:TayfunAiProduct;current:any;previous:any;history:TayfunAiHistory;device?:string}):TayfunKeywordTrend[];
export declare function renderSeoJobs(container:HTMLElement,options:{products:TayfunAiProduct[];month:string;device:string;current:any;previous:any;auto:any;api:(path:string,options?:Record<string,unknown>)=>Promise<any>;notify:(message:string)=>void;onSaved?:()=>void}):void;
