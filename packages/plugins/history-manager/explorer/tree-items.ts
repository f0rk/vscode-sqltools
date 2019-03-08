import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import ConfigManager from '@sqltools/core/config-manager';

export class HistoryTreeItem extends TreeItem {
  public contextValue = 'historyItem';
  public description: string;
  public get tooltip() {
    return this.query;
  }

  constructor(public query: string, public parent: HistoryTreeGroup) {
    super(query, TreeItemCollapsibleState.None);
    this.description = new Date().toLocaleString();
  }
}

export class HistoryTreeGroup extends TreeItem {
  public parent = null;
  public contextValue = 'historyGroup';
  public items: HistoryTreeItem[] = [];
  public get tooltip() {
    return this.name;
  }

  public addItem(query: string) {
    if (!query) {
      return;
    }
    if (this.items.length > 0 && this.items[0].query.trim() === query.toString().trim()) {
      this.items[0].description = new Date().toLocaleString();
      return this.items[0];
    }
    this.items = [new HistoryTreeItem(query, this)].concat(this.items);

    this.sizeKeeper();

    return this.items[0];
  }

  private sizeKeeper = () => {
    if (this.items.length >= this.getMaxSize()) {
      this.items.length = this.getMaxSize();
      this.refresh(this);
    }
  }
  private getMaxSize() {
    return (ConfigManager.historySize || 100);
  }

  constructor(public name: string, private refresh: Function) {
    super(name, TreeItemCollapsibleState.Expanded);

    ConfigManager.addOnUpdateHook(this.sizeKeeper);
  }
}