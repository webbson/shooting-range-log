I want to develop a software for managing weapons and users on a shooting range. 

Weapons
- Brand
- Model
- Serial #
- Service history
- Active/Inactive
- ID (movable between weapons)
- Notes

Users
- Name
- Email
- Phone
- Address
- Member number
- SSN?
- ID (movable between users)
- Notes
- Active/inactive


There will be a log of when people have checked out weapons and handed them back in.
When checking out a weapon you will enter weapon ID or member ID (or by name), the other value will then autopopulate, but can be overridden.
If a weapon is selected for a user, but another user was a fresher user for the weapon a warning will be shown.
Already checked out weapons will not be able to be selected, but it will be shown who has the weapon. 
If the weapon for some reason is inactive we will show the reason.

If we can't make a payment at the time of checkout we can add a debt to the user. This will be highlighed each time the user is selected.



All checkouts/checkins will be tagged with an operator, on launch we will select an operator from the users list, and it's shown in the footer/statusbar. 
All service logs etc will also be logged with operator.


All users and weapons will have the ID, which is purely used for lookup/display. The real UID is hidden but used for foreign keys for bind a weapon to a user etc, this to facilitate moving ID's between weapons/users once they're inactive or retired.


There should be easy ways to get log list of checkouts of weapons and shooting log for users.


There will be a database backup/restore functionality. Backups will be taken automatically, with a simple interface to be able to restore to an earlier point. Probably stored in S3 compatible bucket, decided later.

Interface will be built for simple handling on a touch screen windows laptop, and optimized for running in 2560x1440, 1920x1200, 1920x1080. 

Interface will be built with Rust and Tauri and binaries built for windows, and published as public GitHub releases which the app's updater checks on launch. Though development can happen on Mac. 
