/* global PlugIn Version Project Alert Tag Task */
(() => {
  const dependencyLibrary = new PlugIn.Library(new Version('1.0'))

  dependencyLibrary.loadSyncedPrefs = () => {
    const syncedPrefsPlugin = PlugIn.find('com.KaitlinSalzke.SyncedPrefLibrary')

    if (syncedPrefsPlugin !== null) {
      const SyncedPref = syncedPrefsPlugin.library('syncedPrefLibrary').SyncedPref
      return new SyncedPref('com.KaitlinSalzke.DependencyForOmniFocus')
    } else {
      const alert = new Alert(
        'Synced Preferences Library Required',
        'For the Dependency plug-in to work correctly, the \'Synced Preferences for OmniFocus\' plugin(https://github.com/ksalzke/synced-preferences-for-omnifocus) is also required and needs to be added to the plug-in folder separately. Either you do not currently have this plugin installed, or it is not installed correctly.'
      )
      alert.show()
    }
  }

  dependencyLibrary.getLinks = () => {
    const syncedPrefs = dependencyLibrary.loadSyncedPrefs()
    return syncedPrefs.read('links')
  }

  dependencyLibrary.addLink = (prereq, dep) => {
    const syncedPrefs = dependencyLibrary.loadSyncedPrefs()
    const links = dependencyLibrary.getLinks() || []

    links.push([prereq.id.primaryKey, dep.id.primaryKey])
    syncedPrefs.write('links', links)
  }

  dependencyLibrary.removeLink = (prereq, dep) => {
    const syncedPrefs = dependencyLibrary.loadSyncedPrefs()
    const links = dependencyLibrary.getLinks() || []
    const updated = links.filter(link => !(link[0] === prereq.id.primaryKey && link[1] === dep.id.primaryKey))
    syncedPrefs.write('links', updated)
  }

  dependencyLibrary.makeDependant = async (prereq, dep) => {
    const prerequisiteTag = await dependencyLibrary.getPrefTag('prerequisiteTag')
    const dependantTag = await dependencyLibrary.getPrefTag('dependantTag')
    const markerTag = await dependencyLibrary.getPrefTag('markerTag')

    // add tags
    dep.addTag(dependantTag)
    prereq.addTag(prerequisiteTag)

    // if dependant is project, set to on hold
    if (dep.project !== null) dep.project.status = Project.Status.OnHold

    // prepend prerequisite details to notes
    dep.note = `[ PREREQUISITE: omnifocus:///task/${prereq.id.primaryKey} ] ${prereq.name}\n\n${dep.note}`
    prereq.note = `[ DEPENDANT: omnifocus:///task/${dep.id.primaryKey} ] ${dep.name}\n\n${prereq.note}`

    // save link in synced prefs
    dependencyLibrary.addLink(prereq, dep)

    // if dependant task has children:
    if (dep.hasChildren && dep.sequential) dependencyLibrary.makeDependant(dep.children[0])
    if (dep.hasChildren && !dep.sequential) dep.children.forEach(child => dependencyLibrary.makeDependant(child, prereq))

    // remove marker tag used for processing
    prereq.removeTag(markerTag)
  }

  dependencyLibrary.getPrefTag = async (prefTag) => {
    const preferences = dependencyLibrary.loadSyncedPrefs()
    const tagID = preferences.readString(`${prefTag}ID`)

    if (tagID !== null) return Tag.byIdentifier(tagID)

    // if not set, show preferences pane and then try again
    await this.action('preferences').perform()
    return dependencyLibrary.getPrefTag(prefTag)
  }

  dependencyLibrary.getDependants = (task) => {
    const links = dependencyLibrary.getLinks()
    return links.filter(link => link[0] === task.id.primaryKey).map(link => Task.byIdentifier(link[1]))
  }

  dependencyLibrary.getPrereqs = async (task) => {
    const links = dependencyLibrary.getLinks()
    return links.filter(link => link[1] === task.id.primaryKey).map(link => Task.byIdentifier(link[0]))
  }

  dependencyLibrary.checkDependants = async (task) => {
    const dependantTag = await dependencyLibrary.getPrefTag('dependantTag')
    const prerequisiteTask = task

    // get array of dependant tasks
    const dependantTasks = await dependencyLibrary.getDependants(task)

    function removeDependant (dependant, prerequisiteTask) {
      // get task ID of selected task
      const prerequisiteTaskId = prerequisiteTask.id.primaryKey

      // remove the link
      dependencyLibrary.removeLink(prerequisiteTask, dependant)

      const regexString =
        '[ ?PREREQUISITE: omnifocus:///task/' + prerequisiteTaskId + ' ?].+'
      RegExp.quote = function (str) {
        return str.replace(/([*^$[\]\\(){}|-])/g, '\\$1')
      }
      const regexForNoteSearch = new RegExp(RegExp.quote(regexString))
      dependant.note = dependant.note.replace(regexForNoteSearch, '')
      // check whether any remaining prerequisite tasks listed in the note
      // (i.e. whether all prerequisites completed) - and if so
      if (!/\[ ?PREREQUISITE:/.test(dependant.note)) {
        // if no remaining prerequisites, remove 'Waiting' tag from dependant task
        // (and if project set to Active)
        dependant.removeTag(dependantTag)
        if (dependant.project !== null) {
          dependant.project.status = Project.Status.Active
        }
      }

      // if dependant task has children:
      if (dependant.hasChildren) {
        if (dependant.sequential) {
          removeDependant(dependant.children[0], prerequisiteTask)
        } else {
          dependant.children.forEach((child) => {
            removeDependant(child, prerequisiteTask)
          })
        }
      }
    }

    dependantTasks.forEach((dependantTask) => {
      if (prerequisiteTask.completed) {
        removeDependant(dependantTask, prerequisiteTask)
      }
    })
  }

  dependencyLibrary.checkDependantsForTaskAndAncestors = (task) => {
    const functionLib = PlugIn.find('com.KaitlinSalzke.functionLibrary').library(
      'functionLibrary'
    )

    // get list of all "parent" tasks (up to project level)
    const listOfTasks = [task]
    let parent = functionLib.getParent(task)
    while (parent !== null) {
      listOfTasks.push(parent)
      parent = functionLib.getParent(parent)
    }

    // check this task, and any parent tasks, for dependants
    listOfTasks.forEach(async (task) => await dependencyLibrary.checkDependants(task))
  }

  return dependencyLibrary
})()
