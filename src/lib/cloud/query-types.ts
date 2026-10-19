// Shape of a data request sent from the browser to the server.
export type QueryFilter = { col: string; op: string; val: any; neg?: boolean };

export type QuerySpec = {
  table: string;
  action: "select" | "insert" | "update" | "upsert" | "delete";
  payload: any;
  upsertKey: string | null;
  filters: QueryFilter[];
  orders: { col: string; asc: boolean }[];
  limit: number | null;
  rangeFrom: number | null;
  rangeTo: number | null;
  mode: "many" | "single" | "maybe";
  count: boolean;
  head: boolean;
  returning: boolean;
};

export type QueryResult = { data: any; error: { message: string; code?: string } | null; count?: number | null; rows?: any[] };
