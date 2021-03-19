import { RedshiftDataClient, ExecuteStatementCommand, GetStatementResultCommand } from "@aws-sdk/client-redshift-data";
import type { ExecuteStatementCommandInput, GetStatementResultCommandInput } from "@aws-sdk/client-redshift-data";
import Queries from './queries';
import { IConnectionDriver, NSDatabase, Arg0, ContextValue, MConnectionExplorer } from '@sqltools/types';
import AbstractDriver from '@sqltools/base-driver';
import zipObject from 'lodash/zipObject';
import { parse as queryParse } from '@sqltools/util/query';
import generateId from '@sqltools/util/internal-id';

interface Credentials {
    ClusterIdentifier: string;
    Database: string;
    dbUser?: string;
    secretArn?: string;
}

export default class Redshift extends AbstractDriver<RedshiftDataClient, Credentials> implements IConnectionDriver {
  queries = Queries;

  public async open() {
    if (this.connection) {
      return this.connection;
    }
    try {
      let rs = new RedshiftDataClient({});
      this.connection = Promise.resolve(rs);
      return this.connection;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  public async close() {
    if (!this.connection) return Promise.resolve();
    this.connection = null;
  }

  private getExecuteCommand(text) {
    const params: ExecuteStatementCommandInput = {
      ClusterIdentifier: this.credentials.clusterIdentifier,
      Database: this.credentials.database,
      Sql: text,
    }

    if (this.credentials.dbUser) {
      params.DbUser = this.credentials.dbUser;
    }

    if (this.credentials.secretArn) {
      params.SecretArn = this.credentials.secretArn;
    }

    const command = new ExecuteStatementCommand(params);
    return command;
  }

  private async runQuery(client, text): Promise<any[]> {
    const executeCommand = this.getExecuteCommand(text);
    const executeResult = await client.send(executeCommand);

    const results = [];

    let lastToken;

    while (true) {
      const resultsParams: GetStatementResultCommandInput = {
          Id: executeResult.Id,
      };

      if (lastToken) {
          resultsParams.NextToken = lastToken;
      }
    
      const resultsCommand = new GetStatementResultCommand(resultsParams);

      const resultsResponse = await client.send(resultsCommand);

      for (const result of resultsResponse.Records) {
          results.push(result);
      }

      if (resultsResponse.NextToken) {
          lastToken = resultsResponse.NextToken;
      } else {
          break;
      }
    }

    return Promise.resolve(results);
  }

  public query: (typeof AbstractDriver)['prototype']['query'] = (query, opt = {}) => {
    const { requestId } = opt;
    return this.open()
      .then(async (client) => {
        const results = await this.runQuery(client, query.toString());
        return results;
      })
      .then((results: any[] | any) => {
        const queries = queryParse(query.toString(), 'pg');
        if (!Array.isArray(results)) {
          results = [results];
        }

        return results.map((r, i): NSDatabase.IResult => {
          const cols = this.getColumnNames(r || []);
          return {
            requestId,
            resultId: generateId(),
            connId: this.getId(),
            cols,
            query: queries[i],
            messages: [],
            results: this.mapRows(r.rows, cols),
          };
        });
      })
      .catch(err => {
        return [<NSDatabase.IResult>{
          connId: this.getId(),
          requestId,
          resultId: generateId(),
          cols: [],
          error: true,
          rawError: err,
          query,
          messages: [],
          results: [],
        }];
      });
  }

  private getColumnNames(r: any): string[] {
    return Object.keys(r);
  }

  private mapRows(rows: any[], columns: string[]): any[] {
    return rows.map((r) => zipObject(columns, r));
  }

  private async getColumns(parent: NSDatabase.ITable): Promise<NSDatabase.IColumn[]> {
    const results = await this.queryResults(this.queries.fetchColumns(parent));
    return results.map(col => ({
      ...col,
      iconName: col.isPk ? 'pk' : (col.isFk ? 'fk' : null),
      childType: ContextValue.NO_CHILD,
      table: parent
    }));
  }

  public async testConnection() {
    const client = await this.open();
    await this.runQuery(client, "SELECT 1");
  }

  public async getChildrenForItem({ item, parent }: Arg0<IConnectionDriver['getChildrenForItem']>) {
    switch (item.type) {
      case ContextValue.CONNECTION:
      case ContextValue.CONNECTED_CONNECTION:
        return this.queryResults(this.queries.fetchDatabases());
      case ContextValue.TABLE:
      case ContextValue.VIEW:
      case ContextValue.MATERIALIZED_VIEW:
        return this.getColumns(item as NSDatabase.ITable);
      case ContextValue.DATABASE:
        return <MConnectionExplorer.IChildItem[]>[
          { label: 'Schemas', type: ContextValue.RESOURCE_GROUP, iconId: 'folder', childType: ContextValue.SCHEMA },
        ];
      case ContextValue.RESOURCE_GROUP:
        return this.getChildrenForGroup({ item, parent });
      case ContextValue.SCHEMA:
        return <MConnectionExplorer.IChildItem[]>[
          { label: 'Tables', type: ContextValue.RESOURCE_GROUP, iconId: 'folder', childType: ContextValue.TABLE },
          { label: 'Views', type: ContextValue.RESOURCE_GROUP, iconId: 'folder', childType: ContextValue.VIEW },
          { label: 'Materialized Views', type: ContextValue.RESOURCE_GROUP, iconId: 'folder', childType: ContextValue.MATERIALIZED_VIEW },
          { label: 'Functions', type: ContextValue.RESOURCE_GROUP, iconId: 'folder', childType: ContextValue.FUNCTION },
        ];
    }
    return [];
  }
  private async getChildrenForGroup({ parent, item }: Arg0<IConnectionDriver['getChildrenForItem']>) {
    switch (item.childType) {
      case ContextValue.SCHEMA:
        return this.queryResults(this.queries.fetchSchemas(parent as NSDatabase.IDatabase));
      case ContextValue.TABLE:
        return this.queryResults(this.queries.fetchTables(parent as NSDatabase.ISchema));
      case ContextValue.VIEW:
        return this.queryResults(this.queries.fetchViews(parent as NSDatabase.ISchema));
      case ContextValue.MATERIALIZED_VIEW:
        return this.queryResults(this.queries.fetchMaterializedViews(parent as NSDatabase.ISchema));
      case ContextValue.FUNCTION:
        return this.queryResults(this.queries.fetchFunctions(parent as NSDatabase.ISchema));
    }
    return [];
  }

  public searchItems(itemType: ContextValue, search: string, extraParams: any = {}): Promise<NSDatabase.SearchableItem[]> {
    switch (itemType) {
      case ContextValue.TABLE:
        return this.queryResults(this.queries.searchTables({ search }));
      case ContextValue.COLUMN:
        return this.queryResults(this.queries.searchColumns({ search, ...extraParams }));
    }
  }

  private completionsCache: { [w: string]: NSDatabase.IStaticCompletion } = null;
  public getStaticCompletions = async () => {
    if (this.completionsCache) return this.completionsCache;
    this.completionsCache = {};
    const items = await this.queryResults('SELECT UPPER(word) AS label, UPPER(catdesc) AS desc FROM pg_get_keywords();');

    items.forEach((item: any) => {
      this.completionsCache[item.label] = {
        label: item.label,
        detail: item.label,
        filterText: item.label,
        sortText: (['SELECT', 'CREATE', 'UPDATE', 'DELETE'].includes(item.label) ? '2:' : '') + item.label,
        documentation: {
          value: `\`\`\`yaml\nWORD: ${item.label}\nTYPE: ${item.desc}\n\`\`\``,
          kind: 'markdown'
        }
      }
    });

    return this.completionsCache;
  }
}
