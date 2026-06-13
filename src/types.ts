export interface Channel {
  name: string;
  url: string;
  logo: string;
  categories: string[];
}

export interface LiveStats {
  liveCount: number;
  totalCount: number;
}
