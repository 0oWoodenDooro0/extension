# Browser Collection & Search Extension

A browser extension for curating web pages with tags and actors in a side panel, launching custom context-menu search queries, and synchronizing data across devices via cloud storage.

## Language

**Collection Item**:
A saved web page in the user's collection, identified uniquely by its ID or canonical URL, containing a title, optional cover image, tags, and actors.
_Avoid_: Bookmark, link, article, record

**Tag**:
A user-defined category label assigned to Collection Items for organization and intersection filtering.
_Avoid_: Category, folder, group, label

**Untagged**:
The filter scope representing Collection Items that currently have no Tags assigned.
_Avoid_: Uncategorized, inbox, no-tag

**Actor**:
A person or creator associated with a Collection Item, used as a secondary filtering dimension independent of Tags.
_Avoid_: Author, creator, performer, cast

**Search Engine**:
A user-configured search target consisting of a title, a destination URL template, and an optional regular expression rule for transforming selected text before searching.
_Avoid_: Search shortcut, search provider, quick search

**Unified Backup**:
A complete, portable snapshot of user data containing all Collection Items, Tags, and Search Engines for export, import, or synchronization.
_Avoid_: Unified data, backup payload, dump

**Base Snapshot**:
The Unified Backup recorded at the conclusion of the last successful cloud synchronization, used as the common ancestor in a three-way merge to distinguish new additions from deletions.
_Avoid_: Base data, sync cache, previous backup
